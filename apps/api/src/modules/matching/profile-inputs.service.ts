import { Injectable } from '@nestjs/common';
import type { CommuneDto } from '@jobtrack/shared';
import { CommuneService } from '../jobs/commune.service';
import { normalizeForKey } from '../jobs/lib/text';
import { PrismaService } from '../../common/prisma.service';
import { computeExperienceYears, educationLevelFromDegree, maxEducationLevel, profileFingerprint, type ProfileInputs } from './scoring';

/** Nombre maximal de lieux souhaités résolus par profil (spec §5 : « ≤ 10 »). */
const MAX_LOCATIONS = 10;

/** Résultat de `ProfileInputsService.build` : entrées du moteur, empreinte, complétude et identifiant du profil. */
export interface ProfileInputsResult {
  inputs: ProfileInputs;
  fingerprint: string;
  complete: boolean;
  profileId: string;
}

/** Commune résolue : code INSEE et département, seuls champs utiles au moteur de score. */
type ResolvedCommune = Pick<CommuneDto, 'code' | 'departmentCode'>;

/**
 * Construit les entrées profil du moteur de score (`ProfileInputs`, spec §5)
 * à partir du `Profile` Prisma de l'utilisateur : une seule lecture (avec ses
 * collections), sans écriture. Les lieux souhaités (préférences + ville du
 * profil) sont résolus en communes France Travail via `CommuneService`, en
 * exigeant une correspondance de nom exacte (normalisée) pour ne jamais
 * confondre deux communes au nom proche (« Metz » / « Metzeresche », spec
 * §5) ; chaque nom n'est résolu qu'une fois par appel (mémoïsation locale).
 */
@Injectable()
export class ProfileInputsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly communeService: CommuneService,
  ) {}

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
    // d'un `null` ferait à tort passer ce cas pour une expérience connue.
    const experienceYears = experiences.length > 0 ? computeExperienceYears(experiences, now) : (profile.yearsExperience ?? null);

    const educationLevel = maxEducationLevel(profile.educations.map((education) => educationLevelFromDegree(education.degree)));

    const projectTechnologies = profile.projects.flatMap((project) => project.technologies);

    const communeMemo = new Map<string, ResolvedCommune | null>();
    const resolveCommune = async (rawName: string): Promise<ResolvedCommune | null> => {
      const trimmed = rawName.trim();
      if (!trimmed) return null;
      const key = normalizeForKey(trimmed);
      if (!key) return null;
      const cached = communeMemo.get(key);
      if (cached !== undefined) return cached;

      const [first] = await this.communeService.search(trimmed, 1);
      const resolved = first && normalizeForKey(first.name) === key ? { code: first.code, departmentCode: first.departmentCode } : null;
      communeMemo.set(key, resolved);
      return resolved;
    };

    const locationNames = (profile.preferences?.locations ?? []).slice(0, MAX_LOCATIONS);
    const preferredCommuneCodes = new Set<string>();
    const preferredDepartmentCodes = new Set<string>();
    for (const name of locationNames) {
      const resolved = await resolveCommune(name);
      if (resolved) {
        preferredCommuneCodes.add(resolved.code);
        preferredDepartmentCodes.add(resolved.departmentCode);
      }
    }
    if (profile.city) {
      const resolved = await resolveCommune(profile.city);
      if (resolved) {
        preferredCommuneCodes.add(resolved.code);
        preferredDepartmentCodes.add(resolved.departmentCode);
      }
    }

    const complete = profile.skills.length > 0 || profile.experiences.length > 0;

    const inputs: ProfileInputs = {
      skills: profile.skills.map((skill) => ({ name: skill.name, level: skill.level })),
      projectTechnologies,
      experienceYears,
      experiences,
      educationLevel,
      languages: profile.languages.map((language) => ({ name: language.name, level: language.level })),
      preferredCommuneCodes: [...preferredCommuneCodes],
      preferredDepartmentCodes: [...preferredDepartmentCodes],
      salaryMin: profile.preferences?.salaryMin ?? null,
      salaryMax: profile.preferences?.salaryMax ?? null,
      contractTypes: profile.preferences?.contractTypes ?? [],
      remoteModes: profile.preferences?.remoteModes ?? [],
      experienceLevel: profile.preferences?.experienceLevel ?? null,
      complete,
    };

    return { inputs, fingerprint: profileFingerprint(inputs), complete, profileId: profile.id };
  }
}
