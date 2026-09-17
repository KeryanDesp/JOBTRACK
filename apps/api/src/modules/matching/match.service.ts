import { Injectable, Logger } from '@nestjs/common';
import { Prisma, type JobAnalysisStatus } from '@prisma/client';
import { z } from 'zod';
import {
  factorKeySchema,
  jobRequirementsSchema,
  type MatchAnalysisStatus,
  type MatchFactorDto,
  type MatchScoreDto,
  type MatchScoreSummaryDto,
} from '@jobtrack/shared';
import { PrismaService } from '../../common/prisma.service';
import { JobAnalysisService } from './job-analysis.service';
import { ProfileInputsService } from './profile-inputs.service';
import { scoreJob, type JobInputs, type MatchResult } from './scoring';

/** Sélection minimale d'une offre pour le moteur de score (`JobInputs` + l'analyse, spec §5). */
const JOB_SELECT = {
  id: true,
  communeCode: true,
  departmentCode: true,
  contractType: true,
  remoteMode: true,
  remoteModeInferred: true,
  experienceLevel: true,
  experienceRequired: true,
  salaryMinAnnual: true,
  salaryMaxAnnual: true,
  publishedAt: true,
  skills: { select: { name: true, required: true } },
  requirements: { select: { kind: true, label: true, required: true } },
  // `analyzedAt`/`error` inclus ici pour que `getDetail` n'ait plus besoin d'une lecture séparée
  // de `JobAnalysis` (revue tâche 5 — un seul aller-retour couvre `ensureScores` et `getDetail`).
  analysis: { select: { status: true, version: true, requirements: true, analyzedAt: true, error: true } },
} satisfies Prisma.JobSelect;

type JobRow = Prisma.JobGetPayload<{ select: typeof JOB_SELECT }>;

/** Nombre maximal d'upserts par transaction (spec §8 : « ≤ 20 upserts, transaction courte »). */
const MAX_UPSERT_BATCH = 20;

/** Un des repères par petits groupes de `size`, dans l'ordre. */
function chunk<T>(items: readonly T[], size: number): T[][] {
  const chunks: T[][] = [];
  for (let index = 0; index < items.length; index += size) chunks.push(items.slice(index, index + size));
  return chunks;
}

// ---------------------------------------------------------------------------
// Validation du contenu stocké dans `MatchScore.factors` (Json)
// ---------------------------------------------------------------------------

const matchEvidenceSchema = z.object({
  kind: z.enum(['ok', 'warn', 'missing', 'info']),
  text: z.string(),
});

const matchFactorSchema = z.object({
  key: factorKeySchema,
  label: z.string(),
  weight: z.number(),
  score: z.number().nullable(),
  status: z.enum(['evaluated', 'unknown']),
  evidence: z.array(matchEvidenceSchema),
});

/**
 * Contenu persisté dans `MatchScore.factors` (Json) : le détail par facteur,
 * l'explication du classement et le drapeau « données insuffisantes »
 * (spec §6, note de conception — choix documenté de la tâche 5 : un seul
 * objet plutôt que trois colonnes, puisque tout provient d'un seul appel à
 * `scoreJob` et n'est jamais interrogé isolément côté SQL). Validé en
 * relecture par ce schéma (jamais par un simple cast, revue tâche 5) : une
 * colonne corrompue ou écrite par une version antérieure incompatible ne doit
 * jamais produire une valeur mal typée en mémoire, seulement déclencher un
 * recalcul (`computeStates`, plus bas).
 */
const storedMatchPayloadSchema = z.object({
  factors: z.array(matchFactorSchema),
  explanation: z.object({ top: z.array(z.string()), weak: z.array(z.string()) }),
  insufficientData: z.boolean(),
});

/** Sérialise le résultat du moteur pour la colonne `Json` (mêmes garanties que `JobAnalysisService.toJson`). */
function toStoredPayload(result: MatchResult): Prisma.InputJsonValue {
  const payload = {
    factors: result.factors,
    explanation: result.explanation,
    insufficientData: result.insufficientData,
  };
  return JSON.parse(JSON.stringify(payload)) as Prisma.InputJsonValue;
}

/** Construit les entrées offre du moteur à partir de la ligne Prisma sélectionnée (`JOB_SELECT`). */
function buildJobInputs(job: JobRow): JobInputs {
  return {
    communeCode: job.communeCode,
    departmentCode: job.departmentCode,
    contractType: job.contractType,
    remoteMode: job.remoteMode,
    remoteModeInferred: job.remoteModeInferred,
    experienceLevel: job.experienceLevel,
    experienceRequired: job.experienceRequired,
    salaryMinAnnual: job.salaryMinAnnual,
    salaryMaxAnnual: job.salaryMaxAnnual,
    skills: job.skills.map((skill) => ({ name: skill.name, required: skill.required })),
    languages: job.requirements
      .filter((requirement) => requirement.kind === 'LANGUAGE')
      .map((requirement) => ({ label: requirement.label, required: requirement.required })),
    publishedAt: job.publishedAt,
  };
}

/** État de correspondance d'une offre pour l'utilisateur — construit une fois par `computeStates`, partagé par `ensureScores` et `getDetail`. */
interface JobMatchState {
  score: number | null;
  band: MatchScoreSummaryDto['band'];
  priority: MatchScoreSummaryDto['priority'];
  explanation: MatchScoreSummaryDto['explanation'];
  factors: MatchFactorDto[];
  computedAt: Date | null;
  insufficientData: boolean;
  /** `null` seulement en l'absence de toute ligne `JobAnalysis` pour cette offre. */
  analysisStatus: JobAnalysisStatus | null;
  analysisError: string | null;
}

function emptyState(): JobMatchState {
  return {
    score: null,
    band: null,
    priority: null,
    explanation: { top: [], weak: [] },
    factors: [],
    computedAt: null,
    insufficientData: true,
    analysisStatus: null,
    analysisError: null,
  };
}

/**
 * Calcule et persiste les scores de correspondance (`MatchScore`, spec §3 et
 * §5) : construit les entrées profil une fois (`ProfileInputsService`), lit
 * les offres et leur analyse, recalcule (`scoreJob`) uniquement ce qui est
 * périmé (empreinte de profil, version d'analyse, ou ré-analyse plus récente
 * que le score stocké) ou absent, et upsert le tout par lots d'au plus
 * `MAX_UPSERT_BATCH` upserts par transaction courte. Une offre dont
 * l'analyse n'est plus `DONE`, ou dont les exigences stockées ne sont plus
 * valides, voit sa ligne `MatchScore` **supprimée** (jamais laissée périmée :
 * une jointure SQL de `GET /jobs`, tâche 6, ne doit jamais trier sur un score
 * obsolète) — dans la même transaction que les upserts du même appel.
 */
@Injectable()
export class MatchService {
  private readonly logger = new Logger(MatchService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly profileInputsService: ProfileInputsService,
    private readonly jobAnalysisService: JobAnalysisService,
  ) {}

  async ensureScores(
    userId: string,
    jobIds: readonly string[],
    now: Date = new Date(),
  ): Promise<{ scores: Record<string, MatchScoreSummaryDto | null>; profileComplete: boolean }> {
    const { states, profileComplete } = await this.computeStates(userId, jobIds, now);
    const scores: Record<string, MatchScoreSummaryDto | null> = {};
    for (const [jobId, state] of states) {
      scores[jobId] =
        state.computedAt !== null
          ? { score: state.score, band: state.band, priority: state.priority, explanation: state.explanation }
          : null;
    }
    return { scores, profileComplete };
  }

  /**
   * Score détaillé d'une offre pour l'utilisateur (`GET /jobs/:id/match`) :
   * recalcule si nécessaire (`computeStates`, partagé avec `ensureScores`),
   * sans relire séparément le profil, l'analyse ou la ligne `MatchScore`
   * (revue tâche 5). `null` seulement si l'offre elle-même n'existe pas
   * (jamais pour un profil incomplet ou une analyse absente, qui sont des
   * états valides du DTO — spec §6) ; cette seule vérification d'existence
   * reste une lecture à part, `computeStates` pouvant renvoyer sans avoir
   * jamais interrogé `Job` (profil incomplet ou absent).
   */
  async getDetail(userId: string, jobId: string, now: Date = new Date()): Promise<MatchScoreDto | null> {
    const job = await this.prisma.job.findUnique({ where: { id: jobId }, select: { id: true } });
    if (!job) return null;

    const { states, profileComplete } = await this.computeStates(userId, [jobId], now);
    const state = states.get(jobId) ?? emptyState();

    return {
      score: state.score,
      band: state.band,
      priority: state.priority,
      explanation: state.explanation,
      factors: state.factors,
      computedAt: state.computedAt ? state.computedAt.toISOString() : null,
      analysis: { status: this.resolveAnalysisStatus(state.analysisStatus), error: state.analysisError },
      profileComplete,
      insufficientData: state.computedAt !== null ? state.insufficientData : true,
    };
  }

  /**
   * Cœur partagé de `ensureScores`/`getDetail` : construit le profil une
   * seule fois (même pour une liste d'offres vide — `profileComplete` doit
   * rester correct dans ce cas, revue tâche 5), puis, si le profil est
   * complet, lit les offres demandées et leurs analyses, détermine pour
   * chacune si son score peut être réutilisé, doit être recalculé, ou si sa
   * ligne `MatchScore` doit être supprimée, et persiste le tout par lots.
   */
  private async computeStates(
    userId: string,
    jobIds: readonly string[],
    now: Date,
  ): Promise<{ states: Map<string, JobMatchState>; profileComplete: boolean }> {
    const uniqueIds = [...new Set(jobIds)];
    const states = new Map<string, JobMatchState>();
    for (const jobId of uniqueIds) states.set(jobId, emptyState());

    const built = await this.profileInputsService.build(userId, now);
    const profileComplete = built?.complete ?? false;
    if (!built || !built.complete || uniqueIds.length === 0) return { states, profileComplete };

    const { inputs, fingerprint, profileId } = built;

    const [jobs, existingRows] = await Promise.all([
      this.prisma.job.findMany({ where: { id: { in: uniqueIds } }, select: JOB_SELECT }),
      this.prisma.matchScore.findMany({ where: { profileId, jobId: { in: uniqueIds } } }),
    ]);
    const existingByJobId = new Map(existingRows.map((row) => [row.jobId, row]));

    const toUpsert: { jobId: string; result: MatchResult; analysisVersion: number }[] = [];
    const toDelete: string[] = [];

    for (const job of jobs) {
      const state = states.get(job.id);
      if (!state) continue; // ne peut pas arriver : `job.id` provient de `uniqueIds`.

      const analysis = job.analysis;
      state.analysisStatus = analysis?.status ?? null;
      state.analysisError = analysis?.status === 'FAILED' ? (analysis.error ?? null) : null;

      if (!analysis || analysis.status !== 'DONE') {
        // Une ligne déjà calculée pour une version d'analyse antérieure (redevenue `PENDING`/
        // `FAILED` depuis) n'a plus aucune raison d'être servie : elle est supprimée, jamais
        // laissée périmée (revue tâche 5 — `GET /jobs` ne doit jamais trier dessus).
        if (existingByJobId.has(job.id)) toDelete.push(job.id);
        continue;
      }

      const parsedRequirements = jobRequirementsSchema.safeParse(analysis.requirements);
      if (!parsedRequirements.success) {
        // Jamais le contenu des exigences, seulement l'identifiant de l'offre (spec §8).
        this.logger.warn(`Exigences d'analyse invalides pour l'offre ${job.id}, score non calculé.`);
        if (existingByJobId.has(job.id)) toDelete.push(job.id);
        continue;
      }

      const existing = existingByJobId.get(job.id);
      // `analyzedAt` conditionne la réutilisation : une ré-analyse à version égale (retry manuel
      // sur une offre déjà `DONE`, par exemple) doit invalider un score calculé avant elle, même
      // si l'empreinte de profil et la version n'ont pas changé (revue tâche 5). `analyzedAt` nul
      // sur une analyse `DONE` ne devrait jamais arriver (`JobAnalysisService` le pose toujours) —
      // traité par prudence comme « jamais réutilisable » plutôt que de risquer un score obsolète.
      const canReuse =
        existing !== undefined &&
        existing.profileFingerprint === fingerprint &&
        existing.analysisVersion === analysis.version &&
        analysis.analyzedAt !== null &&
        existing.computedAt >= analysis.analyzedAt;

      if (canReuse && existing) {
        const payload = storedMatchPayloadSchema.safeParse(existing.factors);
        if (payload.success) {
          state.score = existing.score;
          state.band = existing.band;
          state.priority = existing.priority;
          state.explanation = payload.data.explanation;
          state.factors = payload.data.factors;
          state.computedAt = existing.computedAt;
          state.insufficientData = payload.data.insufficientData;
          continue;
        }
        // Ligne à jour (empreinte, version, fraîcheur) mais contenu illisible (colonne corrompue,
        // format d'une version antérieure incompatible) : recalculée comme si elle était absente.
      }

      const result = scoreJob(inputs, buildJobInputs(job), parsedRequirements.data, now);
      toUpsert.push({ jobId: job.id, result, analysisVersion: analysis.version });
    }

    if (toDelete.length > 0 || toUpsert.length > 0) {
      await this.persist(profileId, fingerprint, toDelete, toUpsert, now);
    }

    for (const { jobId, result } of toUpsert) {
      const state = states.get(jobId);
      if (!state) continue;
      state.score = result.score;
      state.band = result.band;
      state.priority = result.priority;
      state.explanation = result.explanation;
      state.factors = result.factors;
      state.computedAt = now;
      state.insufficientData = result.insufficientData;
    }

    return { states, profileComplete: true };
  }

  /**
   * Persiste les lignes calculées et supprime les lignes périmées, par lots
   * d'au plus `MAX_UPSERT_BATCH` upserts par transaction : la suppression
   * (un seul `deleteMany`) voyage dans la même transaction que le premier lot
   * — au-delà de 20 offres à mettre à jour (jamais le cas en pratique, les
   * appelants plafonnent déjà à 20 offres par appel), les lots suivants
   * n'ont plus qu'à upserter, la suppression ayant déjà eu lieu.
   */
  private async persist(
    profileId: string,
    fingerprint: string,
    deleteJobIds: readonly string[],
    toUpsert: readonly { jobId: string; result: MatchResult; analysisVersion: number }[],
    now: Date,
  ): Promise<void> {
    const upsertChunks = chunk(toUpsert, MAX_UPSERT_BATCH);
    const groups = upsertChunks.length > 0 ? upsertChunks : [[]];

    for (const [index, group] of groups.entries()) {
      const operations: Prisma.PrismaPromise<unknown>[] = [];
      if (index === 0 && deleteJobIds.length > 0) {
        operations.push(this.prisma.matchScore.deleteMany({ where: { profileId, jobId: { in: [...deleteJobIds] } } }));
      }
      for (const entry of group) {
        const data = {
          score: entry.result.score,
          relevance: entry.result.relevance,
          band: entry.result.band,
          priority: entry.result.priority,
          factors: toStoredPayload(entry.result),
          profileFingerprint: fingerprint,
          analysisVersion: entry.analysisVersion,
          computedAt: now,
        };
        operations.push(
          this.prisma.matchScore.upsert({
            where: { profileId_jobId: { profileId, jobId: entry.jobId } },
            create: { profileId, jobId: entry.jobId, ...data },
            update: data,
          }),
        );
      }
      if (operations.length > 0) await this.prisma.$transaction(operations);
    }
  }

  /**
   * Statut d'analyse exposé au détail (spec §6) : sans ligne `JobAnalysis`,
   * distingue « IA non configurée » (rien n'est simulé) de « non analysée
   * pour l'instant » — seule différence avec un simple mappage direct du
   * statut Prisma.
   */
  private resolveAnalysisStatus(status: JobAnalysisStatus | null): MatchAnalysisStatus {
    if (!status) return this.jobAnalysisService.isConfigured() ? 'none' : 'ai_not_configured';
    if (status === 'DONE') return 'done';
    if (status === 'PENDING') return 'pending';
    return 'failed';
  }
}
