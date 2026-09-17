import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../common/prisma.service';
import { normalizeForKey } from '../jobs/lib/text';
import { computeExperienceYears, educationLevelFromDegree, maxEducationLevel, profileFingerprint, type ProfileInputs } from './scoring';

/** Nombre maximal de lieux souhaités résolus par profil (spec §5 : « ≤ 10 »), ville du profil incluse. */
const MAX_LOCATIONS = 10;

/**
 * Nombre minimal de communes homonymes trouvées par préfixe pour appliquer le
 * repli « département seul » (spec §5, arrondissements de Paris/Lyon/Marseille) :
 * un unique résultat de préfixe n'est jamais une raison suffisante d'attribuer un
 * département — ce serait confondre une commune avec une autre qui partage
 * simplement un début de nom (« Metz » / « Metzeresche »). Les arrondissements
 * apparaissent toujours par lots d'au moins deux dans le référentiel.
 */
const MIN_HOMONYM_PREFIX_HITS = 2;

/** Retire un suffixe « (NN) » de département (« Metz (57) » → « Metz ») avant toute résolution. */
const TRAILING_DEPARTMENT_SUFFIX = /\s*\([0-9A-Za-z]{2,3}\)\s*$/;

/** Un code postal français : 5 chiffres, comparé à `Commune.postalCode` par égalité stricte (jamais par préfixe). */
const POSTAL_CODE_PATTERN = /^\d{5}$/;

/** Résultat de `ProfileInputsService.build` : entrées du moteur, empreinte, complétude et identifiant du profil. */
export interface ProfileInputsResult {
  inputs: ProfileInputs;
  fingerprint: string;
  complete: boolean;
  profileId: string;
}

/** Sélection minimale d'une commune pour la résolution des lieux souhaités. */
const COMMUNE_SELECT = { code: true, nameNormalized: true, postalCode: true, departmentCode: true } satisfies Prisma.CommuneSelect;
type CommuneRow = Prisma.CommuneGetPayload<{ select: typeof COMMUNE_SELECT }>;

interface CommuneResolution {
  communeCodes: string[];
  departmentCodes: string[];
}

/**
 * Construit les entrées profil du moteur de score (`ProfileInputs`, spec §5) à
 * partir du `Profile` Prisma de l'utilisateur : plusieurs lectures (une pour
 * le profil, une par collection incluse — `preferences`, `skills`,
 * `experiences`, `educations`, `languages`, `projects` — Prisma n'émet pas de
 * jointure SQL unique pour un `include` multi-relations, donc 1 + 6 requêtes
 * au total ici), jamais d'écriture. Les lieux souhaités (préférences + ville
 * du profil) sont résolus en communes France Travail par une résolution
 * batch : deux requêtes au plus (correspondance exacte, puis repli par
 * préfixe pour les seuls noms non résolus), quel que soit le nombre de lieux
 * — contre une requête par lieu dans une implémentation naïve.
 */
@Injectable()
export class ProfileInputsService {
  constructor(private readonly prisma: PrismaService) {}

  async build(userId: string, now: Date = new Date()): Promise<ProfileInputsResult | null> {
    const profile = await this.prisma.profile.findUnique({
      where: { userId },
      include: {
        preferences: true,
        skills: true,
        experiences: true,
        educations: true,
        languages: true,
        projects: true,
      },
    });
    if (!profile) return null;

    const experiences = profile.experiences.map((experience) => ({
      startDate: experience.startDate,
      endDate: experience.endDate,
      isCurrent: experience.isCurrent,
    }));
    // `computeExperienceYears` seulement quand des expériences détaillées existent : à défaut,
    // on retombe sur la saisie manuelle (`Profile.yearsExperience`, carte « Professionnel » du
    // profil) plutôt que sur `0`, pour que le facteur Expérience puisse encore juger
    // « profil sans expérience et offre sans exigence → non évalué » (spec §5) — un `0` au lieu
    // d'un `null` ferait à tort passer ce cas pour une expérience connue. Effet de bord accepté
    // sur l'empreinte (`fingerprint.ts`, qui inclut `experienceYears`) : pour un poste `isCurrent`
    // sans date de fin, cette valeur dépend de `now` et dérive d'environ un dixième d'année tous
    // les ~36 jours (arrondi de `computeExperienceYears`) — un recalcul silencieux et sans
    // conséquence (le facteur Expérience compare des tranches d'années, pas des dixièmes),
    // jamais déclenché par une vraie modification du profil.
    const experienceYears = experiences.length > 0 ? computeExperienceYears(experiences, now) : (profile.yearsExperience ?? null);

    const educationLevel = maxEducationLevel(profile.educations.map((education) => educationLevelFromDegree(education.degree)));

    const projectTechnologies = profile.projects.flatMap((project) => project.technologies);

    // La ville du profil est fusionnée aux lieux souhaités *avant* d'appliquer `MAX_LOCATIONS` :
    // avec dix lieux souhaités déjà renseignés, la ville peut donc se retrouver tronquée plutôt
    // que de porter le total résolu à onze (choix documenté, tâche 5 — amendement revue).
    const rawLocationNames = [...(profile.preferences?.locations ?? []), ...(profile.city ? [profile.city] : [])].slice(
      0,
      MAX_LOCATIONS,
    );
    const { communeCodes: preferredCommuneCodes, departmentCodes: preferredDepartmentCodes } =
      await this.resolveCommunes(rawLocationNames);

    const complete = profile.skills.length > 0 || profile.experiences.length > 0;

    const inputs: ProfileInputs = {
      skills: profile.skills.map((skill) => ({ name: skill.name, level: skill.level })),
      projectTechnologies,
      experienceYears,
      experiences,
      educationLevel,
      languages: profile.languages.map((language) => ({ name: language.name, level: language.level })),
      preferredCommuneCodes,
      preferredDepartmentCodes,
      salaryMin: profile.preferences?.salaryMin ?? null,
      salaryMax: profile.preferences?.salaryMax ?? null,
      contractTypes: profile.preferences?.contractTypes ?? [],
      remoteModes: profile.preferences?.remoteModes ?? [],
      experienceLevel: profile.preferences?.experienceLevel ?? null,
      complete,
    };

    return { inputs, fingerprint: profileFingerprint(inputs), complete, profileId: profile.id };
  }

  /**
   * Empreinte courante du profil, sans le reste des entrées (tâche 6 : permet
   * à `GET /jobs` de filtrer sa jointure SQL sur `MatchScore.profileFingerprint`
   * sans reconstruire un `ProfileInputs` complet côté appelant, et sans
   * recalculer de score). Un seul appel à `build` en dessous — « par appel »
   * plutôt qu'un cache entre requêtes : cette méthode ne relit rien de plus
   * que ce que `build` lirait déjà pour un usage normal.
   */
  async currentProfileFingerprint(userId: string, now: Date = new Date()): Promise<string | null> {
    const built = await this.build(userId, now);
    return built ? built.fingerprint : null;
  }

  /**
   * Résout un lot de noms de lieux libres en communes France Travail (spec
   * §5) : une requête pour les correspondances exactes (nom normalisé ou code
   * postal), puis — pour les seuls noms sans correspondance exacte — une
   * seconde requête par préfixe, dont le résultat n'est retenu que si au
   * moins `MIN_HOMONYM_PREFIX_HITS` communes homonymes partagent un même
   * département (arrondissements de Paris/Lyon/Marseille) : on ajoute alors
   * ce seul département, jamais un code commune arbitrairement choisi parmi
   * les homonymes. Des homonymes répartis sur plusieurs départements ne sont
   * jamais résolus (ni commune, ni département) — ambiguïté non tranchée.
   */
  private async resolveCommunes(rawNames: readonly string[]): Promise<CommuneResolution> {
    const nameKeys = new Set<string>();
    const postalKeys = new Set<string>();
    for (const raw of rawNames) {
      const stripped = raw.trim().replace(TRAILING_DEPARTMENT_SUFFIX, '').trim();
      if (!stripped) continue;
      if (POSTAL_CODE_PATTERN.test(stripped)) {
        postalKeys.add(stripped);
        continue;
      }
      const key = normalizeForKey(stripped);
      if (key) nameKeys.add(key);
    }
    if (nameKeys.size === 0 && postalKeys.size === 0) return { communeCodes: [], departmentCodes: [] };

    const orConditions: Prisma.CommuneWhereInput[] = [];
    if (nameKeys.size > 0) orConditions.push({ nameNormalized: { in: [...nameKeys] } });
    if (postalKeys.size > 0) orConditions.push({ postalCode: { in: [...postalKeys] } });
    const exactRows = await this.prisma.commune.findMany({ where: { OR: orConditions }, select: COMMUNE_SELECT });

    const communeCodes = new Set<string>();
    const departmentCodes = new Set<string>();
    const unresolvedNameKeys: string[] = [];

    for (const key of nameKeys) {
      const rows = exactRows.filter((row) => row.nameNormalized === key);
      if (rows.length === 0) {
        unresolvedNameKeys.push(key);
        continue;
      }
      this.resolveExact(rows, communeCodes, departmentCodes);
    }
    for (const key of postalKeys) {
      const rows = exactRows.filter((row) => row.postalCode === key);
      // Pas de repli par préfixe pour un code postal (spec : correspondance exacte seulement) :
      // une absence de résultat reste simplement non résolue.
      if (rows.length > 0) this.resolveExact(rows, communeCodes, departmentCodes);
    }

    if (unresolvedNameKeys.length > 0) {
      const prefixRows = await this.prisma.commune.findMany({
        where: { OR: unresolvedNameKeys.map((key) => ({ nameNormalized: { startsWith: key } })) },
        select: COMMUNE_SELECT,
      });
      for (const key of unresolvedNameKeys) {
        const rows = prefixRows.filter((row) => row.nameNormalized.startsWith(key));
        if (rows.length < MIN_HOMONYM_PREFIX_HITS) continue;
        const departmentCodesForKey = new Set(rows.map((row) => row.departmentCode));
        const [singleDepartment] = departmentCodesForKey;
        if (departmentCodesForKey.size === 1 && singleDepartment !== undefined) {
          departmentCodes.add(singleDepartment);
        }
      }
    }

    return { communeCodes: [...communeCodes], departmentCodes: [...departmentCodes] };
  }

  /** Résout un lot de lignes déjà exactement homonymes (même nom normalisé, ou même code postal). */
  private resolveExact(rows: readonly CommuneRow[], communeCodes: Set<string>, departmentCodes: Set<string>): void {
    const departmentCodesForRows = new Set(rows.map((row) => row.departmentCode));
    if (departmentCodesForRows.size > 1) return; // homonymes dans plusieurs départements : non résolu.

    const [first] = rows;
    if (rows.length === 1 && first) {
      communeCodes.add(first.code);
      departmentCodes.add(first.departmentCode);
      return;
    }
    // Plusieurs communes exactement homonymes (même nom, ou même code postal partagé entre
    // communes) mais un seul département : impossible de choisir laquelle, on garde le
    // département seul (même repli que pour les correspondances par préfixe ci-dessous).
    const [department] = departmentCodesForRows;
    if (department !== undefined) departmentCodes.add(department);
  }
}
