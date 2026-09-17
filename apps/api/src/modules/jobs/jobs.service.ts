import { HttpException, HttpStatus, Inject, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { Prisma, type MatchBand, type MatchPriority } from '@prisma/client';
import { z } from 'zod';
import type {
  JobDetailDto,
  JobListResponseDto,
  JobSearchQuery,
  JobSummaryDto,
  JobSyncInfoDto,
  JobTab,
  JobsCapabilitiesDto,
  MatchScoreSummaryDto,
} from '@jobtrack/shared';
import { PrismaService } from '../../common/prisma.service';
import { RateLimiterService } from '../../common/rate-limiter.service';
import { rateLimitKey } from '../../common/rate-limit.guard';
import { RedisService } from '../../common/redis.service';
import { JobAnalysisService } from '../matching/job-analysis.service';
import { JOB_ANALYSIS_VERSION } from '../matching/job-analysis.prompt';
import { ProfileInputsService } from '../matching/profile-inputs.service';
import { JobSyncService } from './job-sync.service';
import { JOB_SOURCE_CONNECTORS, isConfigured, type JobSourceConnector } from './sources/job-source.connector';

const PAGE_SIZE = 20;
// Budget explicite (bouton « Actualiser », spec §2 et §5) : peu de requêtes, mais chacune
// force une vraie synchronisation (`force: true`, cache ignoré).
const REFRESH_BUCKET = 'jobs-sync';
const REFRESH_RATE_LIMIT = { limit: 6, windowSeconds: 600 };
// Budget implicite (revue sécurité) : couvre les synchronisations déclenchées sans
// `refresh`, par exemple une suite de recherches distinctes — sans lui, ce chemin échappait
// entièrement à toute limite de débit malgré chaque appel pouvant déclencher un appel réel
// à la source.
const IMPLICIT_SYNC_BUCKET = 'jobs-sync-implicit';
const IMPLICIT_SYNC_RATE_LIMIT = { limit: 30, windowSeconds: 600 };
// Une offre non revue depuis plus de 24 h est re-vérifiée auprès de sa source
// au moment du détail (spec §5) — jamais sur la liste, pour ne pas multiplier
// les appels externes à chaque recherche.
const DETAIL_STALE_AFTER_MS = 24 * 60 * 60 * 1000;
// Marqueur Redis (revue sécurité) : au plus un appel source par offre et par heure, quel
// que soit son résultat (succès, `null`, erreur) — sans lui, une source en panne pour une
// offre donnée serait rappelée à chaque détail consulté dans l'heure.
const DETAIL_CHECK_MARKER_PREFIX = 'jobs:detail-check:';
const DETAIL_CHECK_MARKER_TTL_SECONDS = 60 * 60;

// Onglet « Pour vous » (spec §2, §6) : seuil de score, partagé avec le moteur de score
// (`FACTOR_WEIGHTS`/`PRIORITY_THRESHOLDS` de `@jobtrack/shared` ne portent pas ce seuil-ci,
// propre à l'onglet plutôt qu'à une bande ou une priorité).
const FOR_YOU_MIN_SCORE = 60;
// Onglet « Forte priorité » (spec §2, §6) : les deux priorités hautes du moteur de score.
const PRIORITY_TAB_VALUES: MatchPriority[] = ['VERY_HIGH', 'HIGH'];

// Tri « Meilleur match »/« Pertinence » (spec §6, tâche 6) : Prisma ne sait pas ordonner par un
// champ d'une relation filtrée par une valeur dynamique (`MatchScore` d'un seul profil parmi
// plusieurs par offre) — le classement se fait donc en deux temps ci-dessous (`rankByScore`) sur,
// au plus, les `RELEVANCE_CANDIDATE_CAP` offres les plus récentes correspondant aux filtres : les
// offres au-delà de ce plafond restent trouvables par les autres tris/onglets, mais jamais
// classées par « Meilleur match »/« Pertinence » — les 500 offres les plus récentes sont classées.
const RELEVANCE_CANDIDATE_CAP = 500;

/** Reflet minimal de `MatchScore.factors` (Json) utile à la liste : seule l'explication du
 * classement est nécessaire ici (`MatchScoreSummaryDto`), jamais le détail par facteur — validée
 * pour ne jamais faire confiance aveuglément à une colonne `Json` (revue sécurité). */
const storedMatchExplanationSchema = z.object({
  explanation: z.object({ top: z.array(z.string()), weak: z.array(z.string()) }),
});

/** Champs de `MatchScore` nécessaires à `toMatchSummary` ci-dessous — un sous-ensemble minimal
 * plutôt que le type Prisma complet, pour que les deux points d'appel (tri normal, tri par score)
 * puissent construire cette valeur à partir de sélections différentes. */
interface StoredMatchScoreRow {
  jobId: string;
  score: number | null;
  band: MatchBand | null;
  priority: MatchPriority | null;
  factors: Prisma.JsonValue;
}

/**
 * Identité de profil utilisée pour lire/filtrer `MatchScore` (spec §6, tâche 6 — amendement
 * revue tâche 5) : `profileId` seul ne suffit pas — une ligne `MatchScore` dont
 * `profileFingerprint` diverge de l'empreinte courante du profil a été calculée pour une
 * version antérieure (compétences/expériences depuis modifiées) et doit être traitée comme
 * « non évaluée » (spec §3 : « recalculé... quand `profileFingerprint`... diffère de la valeur
 * stockée, au moment où il est demandé ») plutôt qu'affichée/triée/filtrée comme à jour —
 * seul `POST /jobs/analyses`/`GET /jobs/:id/match` (module `matching`) la recalcule
 * effectivement. `fingerprint: null` (pas de profil, ou profil incomplet) désactive toute
 * jointure, comme `profileId: null`.
 */
interface ProfileScoreContext {
  profileId: string | null;
  fingerprint: string | null;
}

/** Traduit une ligne `MatchScore` (ou son absence) en `MatchScoreSummaryDto` pour `JobSummaryDto.match`
 * (spec §6) : l'explication du classement est relue depuis `factors` (colonne `Json`, jamais écrite
 * que par `MatchService`) et validée — un contenu inattendu retombe sur `null` plutôt que de faire
 * échouer toute la liste (même précaution que `MatchService.fromStoredPayload`, dupliquée ici :
 * `JobsService` lit `MatchScore` directement via Prisma plutôt que d'appeler `MatchService`, pour
 * ne jamais recalculer de score sur une simple lecture de liste).
 */
function toMatchSummary(row: StoredMatchScoreRow | undefined): MatchScoreSummaryDto | null {
  if (!row) return null;
  const parsed = storedMatchExplanationSchema.safeParse(row.factors);
  if (!parsed.success) return null;
  return { score: row.score, band: row.band, priority: row.priority, explanation: parsed.data.explanation };
}

/**
 * Champs de `Job` communs à la liste et aux favoris (spec §8 : jamais la
 * description ni les autres champs volumineux sur la liste). `savedBy` est
 * filtré par utilisateur pour que `saved` reflète l'isolation des favoris
 * sans jointure supplémentaire.
 */
export function buildSummarySelect(userId: string) {
  return {
    id: true,
    title: true,
    company: true,
    companyLogoUrl: true,
    locationLabel: true,
    departmentCode: true,
    contractType: true,
    contractLabel: true,
    remoteMode: true,
    remoteModeInferred: true,
    experienceLevel: true,
    salaryMinAnnual: true,
    salaryMaxAnnual: true,
    salaryLabel: true,
    currency: true,
    publishedAt: true,
    expiredAt: true,
    skills: {
      select: { name: true, required: true },
      orderBy: [{ required: 'desc' }, { name: 'asc' }],
      take: 3,
    },
    sources: { select: { source: true } },
    savedBy: { where: { userId }, select: { id: true } },
  } satisfies Prisma.JobSelect;
}

export type JobSummaryRow = Prisma.JobGetPayload<{ select: ReturnType<typeof buildSummarySelect> }>;

export function toSummaryDto(job: JobSummaryRow): JobSummaryDto {
  return {
    id: job.id,
    title: job.title,
    company: job.company,
    companyLogoUrl: job.companyLogoUrl,
    locationLabel: job.locationLabel,
    departmentCode: job.departmentCode,
    contractType: job.contractType,
    contractLabel: job.contractLabel,
    remoteMode: job.remoteMode,
    remoteModeInferred: job.remoteModeInferred,
    experienceLevel: job.experienceLevel,
    salaryMinAnnual: job.salaryMinAnnual,
    salaryMaxAnnual: job.salaryMaxAnnual,
    salaryLabel: job.salaryLabel,
    currency: job.currency,
    publishedAt: job.publishedAt.toISOString(),
    expiredAt: job.expiredAt ? job.expiredAt.toISOString() : null,
    skills: job.skills.map((skill) => skill.name),
    sources: [...new Set(job.sources.map((source) => source.source))],
    saved: job.savedBy.length > 0,
    // Repli par défaut : `search()` (tâche 6) écrase ce champ avec le score de l'utilisateur
    // lu sur `MatchScore` ; les autres appelants (`GET /jobs/saved`) n'ont pas encore ce
    // besoin et gardent `null`, jamais un score d'un autre contexte par erreur.
    match: null,
  };
}

function buildDetailSelect(userId: string) {
  return {
    ...buildSummarySelect(userId),
    skills: { select: { name: true, required: true }, orderBy: [{ required: 'desc' }, { name: 'asc' }] },
    sources: {
      select: { source: true, externalId: true, url: true, applyUrl: true, partnerName: true, publishedAt: true },
      orderBy: { publishedAt: 'desc' },
    },
    requirements: { select: { kind: true, label: true, required: true } },
    description: true,
    companyDescription: true,
    companyUrl: true,
    communeCode: true,
    postalCode: true,
    latitude: true,
    longitude: true,
    contractNature: true,
    experienceLabel: true,
    experienceRequired: true,
    workingTimeLabel: true,
    isFullTime: true,
    isApprenticeship: true,
    positionsCount: true,
    accessibleTh: true,
    sectorLabel: true,
    romeCode: true,
    romeLabel: true,
    qualificationLabel: true,
    sourceUpdatedAt: true,
    lastSeenAt: true,
  } satisfies Prisma.JobSelect;
}

type JobDetailRow = Prisma.JobGetPayload<{ select: ReturnType<typeof buildDetailSelect> }>;

function toDetailDto(job: JobDetailRow): JobDetailDto {
  return {
    id: job.id,
    title: job.title,
    company: job.company,
    companyLogoUrl: job.companyLogoUrl,
    locationLabel: job.locationLabel,
    departmentCode: job.departmentCode,
    contractType: job.contractType,
    contractLabel: job.contractLabel,
    remoteMode: job.remoteMode,
    remoteModeInferred: job.remoteModeInferred,
    experienceLevel: job.experienceLevel,
    salaryMinAnnual: job.salaryMinAnnual,
    salaryMaxAnnual: job.salaryMaxAnnual,
    salaryLabel: job.salaryLabel,
    currency: job.currency,
    publishedAt: job.publishedAt.toISOString(),
    expiredAt: job.expiredAt ? job.expiredAt.toISOString() : null,
    saved: job.savedBy.length > 0,
    // Toujours `null` ici : le détail d'une offre expose son score via la route dédiée
    // (`GET /jobs/:id/match`, module `matching`), qui recalcule au besoin — jamais ce DTO.
    match: null,
    description: job.description,
    companyDescription: job.companyDescription,
    companyUrl: job.companyUrl,
    communeCode: job.communeCode,
    postalCode: job.postalCode,
    latitude: job.latitude,
    longitude: job.longitude,
    contractNature: job.contractNature,
    experienceLabel: job.experienceLabel,
    experienceRequired: job.experienceRequired,
    workingTimeLabel: job.workingTimeLabel,
    isFullTime: job.isFullTime,
    isApprenticeship: job.isApprenticeship,
    positionsCount: job.positionsCount,
    accessibleTh: job.accessibleTh,
    sectorLabel: job.sectorLabel,
    romeCode: job.romeCode,
    romeLabel: job.romeLabel,
    qualificationLabel: job.qualificationLabel,
    sourceUpdatedAt: job.sourceUpdatedAt ? job.sourceUpdatedAt.toISOString() : null,
    lastSeenAt: job.lastSeenAt.toISOString(),
    skills: job.skills.map((skill) => ({ name: skill.name, required: skill.required })),
    sources: job.sources.map((source) => ({
      kind: source.source,
      externalId: source.externalId,
      url: source.url,
      applyUrl: source.applyUrl,
      partnerName: source.partnerName,
      publishedAt: source.publishedAt.toISOString(),
    })),
    requirements: job.requirements.map((requirement) => ({
      kind: requirement.kind,
      label: requirement.label,
      required: requirement.required,
    })),
  };
}

/** Code département depuis un code commune INSEE (mêmes règles que le mapper France Travail). */
function departmentCodeFromCommuneCode(communeCode: string): string {
  const upper = communeCode.toUpperCase();
  if (upper.startsWith('97') || upper.startsWith('98')) return upper.slice(0, 3);
  return upper.slice(0, 2);
}

function hoursAgo(hours: number, from: Date = new Date()): Date {
  return new Date(from.getTime() - hours * 60 * 60 * 1000);
}

function daysAgo(days: number, from: Date = new Date()): Date {
  return hoursAgo(days * 24, from);
}

/**
 * Neutralise les métacaractères LIKE/ILIKE (`%`, `_`, et `\` lui-même, l'échappement de
 * Postgres) avant un `contains` Prisma (revue sécurité) : sans cet échappement, `q=%`
 * redevient le joker « tout » plutôt qu'une recherche littérale du caractère `%`, et
 * renverrait silencieusement l'intégralité de la base au lieu de zéro résultat.
 */
function escapeLikePattern(value: string): string {
  return value.replace(/[\\%_]/g, '\\$&');
}

/**
 * Service `/jobs` (spec §6 et §8) : synchronisation implicite bornée par le
 * limiteur utilisateur (`refresh`), puis liste locale filtrée/triée depuis la
 * base, détail avec re-vérification d'expiration, et capacités.
 */
@Injectable()
export class JobsService {
  private readonly logger = new Logger(JobsService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly redis: RedisService,
    private readonly rateLimiter: RateLimiterService,
    private readonly syncService: JobSyncService,
    @Inject(JOB_SOURCE_CONNECTORS) private readonly connectors: JobSourceConnector[],
    // `MatchService` (calcul des scores) reste dans le module `matching` : `JobsService` lit
    // `MatchScore` directement via Prisma (spec §6, tâche 6) plutôt que de l'appeler, pour ne
    // jamais déclencher de recalcul sur une simple recherche. `ProfileInputsService` (empreinte
    // courante du profil, amendement tâche 5) est en revanche nécessaire ici pour ne jamais
    // afficher/trier/filtrer un score périmé (`ProfileScoreContext` ci-dessus).
    // `JobAnalysisService.isConfigured()` (amendement revue) remplace une injection directe de
    // `ANTHROPIC_CLIENT` : une seule source de vérité pour « le service IA est-il configuré »,
    // jamais pour analyser une offre depuis ce service.
    private readonly profileInputsService: ProfileInputsService,
    private readonly jobAnalysisService: JobAnalysisService,
  ) {}

  async search(userId: string, query: JobSearchQuery): Promise<JobListResponseDto> {
    if (query.refresh) {
      const key = rateLimitKey(REFRESH_BUCKET, `user:${userId}`);
      const { allowed } = await this.rateLimiter.hit(key, REFRESH_RATE_LIMIT.limit, REFRESH_RATE_LIMIT.windowSeconds);
      if (!allowed) throw this.refreshRateLimited();
    }

    const sync = await this.syncService.ensureFresh(query, {
      force: query.refresh,
      allowSync: () => this.allowImplicitSync(userId),
    });

    // Résolu une seule fois par requête (spec §6), via `ProfileInputsService.build` plutôt qu'une
    // simple lecture de `Profile.id` : construire les entrées complètes du profil est le seul
    // moyen d'obtenir son empreinte courante (`fingerprint.ts`), nécessaire pour ne jamais
    // afficher/trier/filtrer une ligne `MatchScore` périmée (voir `ProfileScoreContext`
    // ci-dessus). Coût accepté et documenté : quelques lectures Prisma indexées par `profileId`
    // (profil + ses collections, cf. `ProfileInputsService.build`), sur une seule offre par
    // requête `GET /jobs` — jamais un recalcul de score (aucun appel à `scoreJob`/Claude ici).
    // Une mise en cache (Redis, par utilisateur) économiserait ce coût mais exigerait une
    // invalidation explicite sur chaque écriture du profil (identité, préférences, compétences,
    // expériences, formations, langues, projets — sept chemins d'écriture distincts,
    // `profile.controller.ts`/`collections/*.controller.ts`) : différé (hors périmètre tâche 6)
    // tant que le volume ne le justifie pas.
    const built = await this.profileInputsService.build(userId);
    const context: ProfileScoreContext = { profileId: built?.profileId ?? null, fingerprint: built?.fingerprint ?? null };

    const where = this.buildWhere(query, context);
    const skip = (query.page - 1) * PAGE_SIZE;

    const { jobIds, total } =
      query.sort === 'match' || query.sort === 'relevance'
        ? await this.rankByScore(where, query.sort, context, skip)
        : await this.rankByColumn(where, query.sort, skip);

    const [summaryRows, matchRows] = await Promise.all([
      this.prisma.job.findMany({ where: { id: { in: jobIds } }, select: buildSummarySelect(userId) }),
      this.matchRowsFor(context, jobIds),
    ]);
    const summaryById = new Map(summaryRows.map((row) => [row.id, row]));
    const matchByJobId = new Map(matchRows.map((row) => [row.jobId, row]));

    // `jobIds` fixe l'ordre déjà calculé (tri SQL ou classement en mémoire ci-dessus) : jamais
    // l'ordre de retour de `findMany({ where: { id: { in: … } } })`, non garanti par Prisma.
    const items = jobIds.flatMap((id) => {
      const row = summaryById.get(id);
      if (!row) return []; // filet défensif : une offre supprimée entre les deux requêtes ci-dessus.
      const dto = toSummaryDto(row);
      dto.match = toMatchSummary(matchByJobId.get(id));
      return [dto];
    });

    const analyzed = items.filter((item) => item.match !== null).length;
    const syncWithAnalysis: JobSyncInfoDto = {
      ...sync,
      analysis: { analyzed, total: items.length, notConfigured: !this.jobAnalysisService.isConfigured() },
    };

    return { items, total, page: query.page, pageSize: PAGE_SIZE, sync: syncWithAnalysis };
  }

  async getDetail(userId: string, id: string): Promise<JobDetailDto> {
    const job = await this.prisma.job.findUnique({ where: { id }, select: buildDetailSelect(userId) });
    if (!job) throw this.notFound();

    const refreshed = await this.refreshIfStale(job);
    return toDetailDto(refreshed);
  }

  capabilities(): JobsCapabilitiesDto {
    return { sources: { franceTravail: isConfigured(this.connectors, 'FRANCE_TRAVAIL') } };
  }

  private buildWhere(query: JobSearchQuery, context: ProfileScoreContext): Prisma.JobWhereInput {
    const and: Prisma.JobWhereInput[] = [{ expiredAt: null }];

    const q = query.q.trim();
    if (q !== '') {
      const escaped = escapeLikePattern(q);
      and.push({
        OR: [
          { title: { contains: escaped, mode: 'insensitive' } },
          { company: { contains: escaped, mode: 'insensitive' } },
        ],
      });
    }

    if (query.communes.length > 0) {
      // Aucune distance n'est calculée localement (pas de coordonnées comparées en base) :
      // au-delà de 0 km, le rayon est approximé en élargissant aux communes ET aux
      // départements des lieux demandés — grossier mais sans coût, jamais présenté comme
      // un rayon exact (spec §5, tâche 6).
      const communeConditions: Prisma.JobWhereInput[] = [{ communeCode: { in: query.communes } }];
      if (query.distance > 0) {
        const departmentCodes = [...new Set(query.communes.map(departmentCodeFromCommuneCode))];
        communeConditions.push({ departmentCode: { in: departmentCodes } });
      }
      and.push({ OR: communeConditions });
    }

    if (query.contractTypes.length > 0) and.push({ contractType: { in: query.contractTypes } });
    if (query.remoteModes.length > 0) and.push({ remoteMode: { in: query.remoteModes } });
    if (query.experienceLevels.length > 0) and.push({ experienceLevel: { in: query.experienceLevels } });

    if (query.salaryMin !== undefined) {
      and.push({
        OR: [{ salaryMaxAnnual: { gte: query.salaryMin } }, { salaryMinAnnual: { gte: query.salaryMin } }],
      });
    }

    if (query.publishedWithinDays !== undefined) {
      and.push({ publishedAt: { gte: daysAgo(query.publishedWithinDays) } });
    }

    if (query.sources.length > 0) and.push({ sources: { some: { source: { in: query.sources } } } });

    this.applyTabFilter(and, query.tab, context);

    return { AND: and };
  }

  /**
   * `switch` exhaustif (jamais de `default` silencieux) : une valeur de `JobTab`
   * oubliée ici est une erreur de compilation (`never`), pas un onglet qui se
   * comporterait par erreur comme « Toutes ».
   */
  private applyTabFilter(and: Prisma.JobWhereInput[], tab: JobTab, context: ProfileScoreContext): void {
    switch (tab) {
      case 'all':
        return;
      case 'new':
        // Onglet « Nouvelles » : publiées depuis 24 h (spec §2), indépendant de `publishedWithinDays`.
        and.push({ publishedAt: { gte: hoursAgo(24) } });
        return;
      case 'for_you':
        // Onglet « Pour vous » (spec §2, §6) : offres dont le score de CE profil, à l'empreinte
        // et à la version d'analyse courantes, atteint le seuil. Sans profil (ou empreinte
        // périmée), le filtre écarte tout plutôt que de risquer un `where` Prisma sur un
        // `profileId` `null` (colonne non nullable). `analysisVersion` exclut une ligne
        // calculée sur des exigences d'une version antérieure du prompt/schéma (amendement
        // revue, même raison que `profileFingerprint`) : un score potentiellement obsolète ne
        // doit jamais faire entrer une offre dans cet onglet.
        and.push(
          context.profileId && context.fingerprint
            ? {
                matches: {
                  some: {
                    profileId: context.profileId,
                    profileFingerprint: context.fingerprint,
                    analysisVersion: JOB_ANALYSIS_VERSION,
                    score: { gte: FOR_YOU_MIN_SCORE },
                  },
                },
              }
            : { id: { in: [] } },
        );
        return;
      case 'priority':
        // Onglet « Forte priorité » (spec §2, §6) : même principe, sur la priorité du profil.
        and.push(
          context.profileId && context.fingerprint
            ? {
                matches: {
                  some: {
                    profileId: context.profileId,
                    profileFingerprint: context.fingerprint,
                    analysisVersion: JOB_ANALYSIS_VERSION,
                    priority: { in: PRIORITY_TAB_VALUES },
                  },
                },
              }
            : { id: { in: [] } },
        );
        return;
      default: {
        const exhaustive: never = tab;
        throw new Error(`Onglet inconnu : ${String(exhaustive)}`);
      }
    }
  }

  /** Tri « Plus récentes »/« Salaire » (spec §6) : classement SQL direct, comme avant la tâche 6. */
  private async rankByColumn(
    where: Prisma.JobWhereInput,
    sort: 'recent' | 'salary',
    skip: number,
  ): Promise<{ jobIds: string[]; total: number }> {
    const orderBy: Prisma.JobOrderByWithRelationInput[] =
      sort === 'salary'
        // Dernier critère `id` : sans lui, deux offres de même salaire et même date de
        // publication n'ont aucun ordre stable entre deux pages successives.
        ? [{ salaryMaxAnnual: { sort: 'desc', nulls: 'last' } }, { publishedAt: 'desc' }, { id: 'asc' }]
        : [{ publishedAt: 'desc' }, { id: 'asc' }];

    const [rows, total] = await this.prisma.$transaction([
      this.prisma.job.findMany({ where, orderBy, skip, take: PAGE_SIZE, select: { id: true } }),
      this.prisma.job.count({ where }),
    ]);
    return { jobIds: rows.map((row) => row.id), total };
  }

  /**
   * Tri « Meilleur match »/« Pertinence » (spec §5, §6) : Prisma ne sait pas ordonner par un
   * champ d'une relation filtrée par une valeur dynamique (`MatchScore` d'un seul profil parmi
   * plusieurs par offre). Classement en deux temps, documenté (amendement revue, spec à
   * modifier en conséquence) : (1) les `RELEVANCE_CANDIDATE_CAP` (500) offres les **plus
   * récentes** correspondant aux filtres (identifiants seuls, `publishedAt desc`) ; (2) un tri
   * en mémoire de ces candidates par score/pertinence décroissant (non évaluées en dernier),
   * fraîcheur puis identifiant en égalité. `total` vaut le nombre de candidates considérées
   * (jamais le compte réel au-delà du plafond) : une page au-delà de ce total est donc
   * toujours vide, plutôt que de faire réapparaître des offres non classées. Une offre plus
   * ancienne que les 500 plus récentes reste trouvable par les autres tris/onglets, mais
   * jamais par « Meilleur match »/« Pertinence ». Sans profil, aucune offre n'a de score :
   * l'ordre retombe sur la fraîcheur seule (même ordre que « Plus récentes »), jamais une erreur.
   */
  private async rankByScore(
    where: Prisma.JobWhereInput,
    sort: 'match' | 'relevance',
    context: ProfileScoreContext,
    skip: number,
  ): Promise<{ jobIds: string[]; total: number }> {
    const candidates = await this.prisma.job.findMany({
      where,
      orderBy: [{ publishedAt: 'desc' }, { id: 'asc' }],
      take: RELEVANCE_CANDIDATE_CAP,
      select: { id: true, publishedAt: true },
    });

    const scoreByJobId =
      context.profileId && context.fingerprint
        ? new Map(
            (
              await this.prisma.matchScore.findMany({
                where: {
                  profileId: context.profileId,
                  profileFingerprint: context.fingerprint,
                  analysisVersion: JOB_ANALYSIS_VERSION,
                  jobId: { in: candidates.map((candidate) => candidate.id) },
                },
                select: { jobId: true, score: true, relevance: true },
              })
            ).map((row): [string, number | null] => [row.jobId, sort === 'match' ? row.score : row.relevance]),
          )
        : new Map<string, number | null>();

    const ranked = [...candidates].sort((a, b) => {
      const scoreA = scoreByJobId.get(a.id) ?? null;
      const scoreB = scoreByJobId.get(b.id) ?? null;
      if (scoreA === null && scoreB === null) return this.compareByFreshness(a, b);
      if (scoreA === null) return 1; // non évaluées en dernier (spec §5).
      if (scoreB === null) return -1;
      if (scoreA !== scoreB) return scoreB - scoreA;
      return this.compareByFreshness(a, b);
    });

    return { jobIds: ranked.slice(skip, skip + PAGE_SIZE).map((row) => row.id), total: ranked.length };
  }

  private compareByFreshness(a: { id: string; publishedAt: Date }, b: { id: string; publishedAt: Date }): number {
    const byDate = b.publishedAt.getTime() - a.publishedAt.getTime();
    if (byDate !== 0) return byDate;
    return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
  }

  /** `MatchScore` de la page pour CE profil, à l'empreinte et à la version d'analyse courantes
   * — jamais celui d'un autre utilisateur, jamais une ligne calculée pour un profil ou une
   * analyse périmés (spec §6). */
  private matchRowsFor(context: ProfileScoreContext, jobIds: string[]): Promise<StoredMatchScoreRow[]> {
    if (!context.profileId || !context.fingerprint || jobIds.length === 0) return Promise.resolve([]);
    return this.prisma.matchScore.findMany({
      where: {
        profileId: context.profileId,
        profileFingerprint: context.fingerprint,
        analysisVersion: JOB_ANALYSIS_VERSION,
        jobId: { in: jobIds },
      },
      select: { jobId: true, score: true, band: true, priority: true, factors: true },
    });
  }

  /**
   * Re-vérifie une offre non revue depuis plus de 24 h auprès de sa source, si un
   * connecteur configuré la couvre (spec §5) — et au plus une fois par heure et par offre
   * (marqueur Redis), quel que soit le résultat de ce dernier appel : une offre dont la
   * source échoue ou renvoie une erreur ne doit jamais être rappelée à chaque détail
   * consulté dans l'heure qui suit. Toute erreur de la source est journalisée et ignorée :
   * le détail reste servi avec les données déjà connues.
   */
  private async refreshIfStale(job: JobDetailRow): Promise<JobDetailRow> {
    // Une offre déjà marquée expirée reste expirée (pas de politique de purge/retour en
    // arrière) : jamais un nouvel appel source pour une offre déjà connue comme dépubliée.
    if (job.expiredAt) return job;
    if (job.lastSeenAt.getTime() >= Date.now() - DETAIL_STALE_AFTER_MS) return job;

    const source = job.sources.find((candidate) =>
      this.connectors.some((connector) => connector.kind === candidate.source),
    );
    if (!source) return job;
    const connector = this.connectors.find((candidate) => candidate.kind === source.source);
    if (!connector) return job;

    const marker = await this.acquireDetailCheckMarker(job.id);
    if (!marker) return job;

    try {
      const offer = await connector.getOffer(source.externalId);
      const now = new Date();
      if (offer === null) {
        await this.prisma.job.update({ where: { id: job.id }, data: { expiredAt: now } });
        return { ...job, expiredAt: now };
      }
      await this.prisma.job.update({ where: { id: job.id }, data: { lastSeenAt: now, expiredAt: null } });
      return { ...job, lastSeenAt: now, expiredAt: null };
    } catch (error) {
      this.logger.debug(`Vérification de fraîcheur ignorée pour ${job.id} : ${(error as Error).message}`);
      return job;
    }
  }

  /** `SET NX EX` : premier appelant dans l'heure seul autorisé à interroger la source. */
  private async acquireDetailCheckMarker(jobId: string): Promise<boolean> {
    const key = `${DETAIL_CHECK_MARKER_PREFIX}${jobId}`;
    try {
      const result = await this.redis.client.set(key, '1', 'EX', DETAIL_CHECK_MARKER_TTL_SECONDS, 'NX');
      return result === 'OK';
    } catch (error) {
      // Redis indisponible : on ne bloque jamais la vérification pour autant, mais alors
      // sans aucune garantie de « au plus une fois par heure » (dégradé, jamais bloquant).
      this.logger.warn(`Marqueur de vérification indisponible (Redis) pour ${jobId} : ${(error as Error).message}`);
      return true;
    }
  }

  /** Budget implicite (30 recherches distinctes / 10 min / utilisateur) — voir `job-sync.service.ts`. */
  private async allowImplicitSync(userId: string): Promise<boolean> {
    const key = rateLimitKey(IMPLICIT_SYNC_BUCKET, `user:${userId}`);
    const { allowed } = await this.rateLimiter.hit(
      key,
      IMPLICIT_SYNC_RATE_LIMIT.limit,
      IMPLICIT_SYNC_RATE_LIMIT.windowSeconds,
    );
    return allowed;
  }

  private notFound(): NotFoundException {
    return new NotFoundException({ code: 'JOB_NOT_FOUND', message: 'Offre introuvable.' });
  }

  private refreshRateLimited(): HttpException {
    return new HttpException(
      { code: 'RATE_LIMITED', message: "Trop d'actualisations. Réessayez dans quelques minutes." },
      HttpStatus.TOO_MANY_REQUESTS,
    );
  }
}
