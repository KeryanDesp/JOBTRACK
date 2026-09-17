import { Injectable, Logger } from '@nestjs/common';
import { Prisma, type JobAnalysisStatus } from '@prisma/client';
import {
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
  analysis: { select: { status: true, version: true, requirements: true } },
} satisfies Prisma.JobSelect;

type JobRow = Prisma.JobGetPayload<{ select: typeof JOB_SELECT }>;

/**
 * Contenu persisté dans `MatchScore.factors` (Json) : le détail par facteur,
 * l'explication du classement et le drapeau « données insuffisantes »
 * (spec §6, note de conception — choix documenté de la tâche 5 : un seul
 * objet plutôt que trois colonnes, puisque tout provient d'un seul appel à
 * `scoreJob` et n'est jamais interrogé isolément côté SQL).
 */
interface StoredMatchPayload {
  factors: MatchFactorDto[];
  explanation: { top: string[]; weak: string[] };
  insufficientData: boolean;
}

/** Sérialise le résultat du moteur pour la colonne `Json` (mêmes garanties que `JobAnalysisService.toJson`). */
function toStoredPayload(result: MatchResult): Prisma.InputJsonValue {
  const payload: StoredMatchPayload = {
    factors: result.factors,
    explanation: result.explanation,
    insufficientData: result.insufficientData,
  };
  return JSON.parse(JSON.stringify(payload)) as Prisma.InputJsonValue;
}

/**
 * Relit `MatchScore.factors` : cette colonne n'est jamais écrite que par
 * `toStoredPayload` ci-dessus (jamais par un modèle ni saisie utilisateur), un
 * décodage typé direct suffit donc — `Prisma.JsonValue` n'ayant pas un
 * recouvrement structurel suffisant avec `StoredMatchPayload` pour un `as`
 * simple, d'où le détour par `unknown`.
 */
function fromStoredPayload(value: Prisma.JsonValue): StoredMatchPayload {
  return value as unknown as StoredMatchPayload;
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

/**
 * Calcule et persiste les scores de correspondance (`MatchScore`, spec §3 et
 * §5) : construit les entrées profil une fois (`ProfileInputsService`), lit
 * les offres et leur analyse, recalcule (`scoreJob`) uniquement ce qui est
 * périmé (empreinte de profil ou version d'analyse différente) ou absent, et
 * upsert le tout en une seule transaction courte (au plus 20 offres par
 * appel, budget porté par l'appelant — spec §4/§8). Une offre sans analyse
 * `DONE`, ou dont les exigences stockées ne sont plus valides, renvoie `null`
 * sans écriture ; une ligne déjà calculée pour une autre version d'analyse ou
 * un profil différent n'est **pas supprimée** pour autant (choix documenté :
 * elle redevient simplement invisible tant qu'elle n'a pas été recalculée,
 * ce qui évite de perdre une donnée exploitable si l'analyse redevient
 * `DONE` à l'identique après une panne passagère).
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
    const uniqueIds = [...new Set(jobIds)];
    const scores: Record<string, MatchScoreSummaryDto | null> = {};
    for (const jobId of uniqueIds) scores[jobId] = null;
    if (uniqueIds.length === 0) return { scores, profileComplete: false };

    const built = await this.profileInputsService.build(userId, now);
    if (!built || !built.complete) return { scores, profileComplete: built?.complete ?? false };
    const { inputs, fingerprint, profileId } = built;

    const [jobs, existingRows] = await Promise.all([
      this.prisma.job.findMany({ where: { id: { in: uniqueIds } }, select: JOB_SELECT }),
      this.prisma.matchScore.findMany({ where: { profileId, jobId: { in: uniqueIds } } }),
    ]);
    const existingByJobId = new Map(existingRows.map((row) => [row.jobId, row]));

    const toUpsert: { jobId: string; result: MatchResult; analysisVersion: number }[] = [];

    for (const job of jobs) {
      const analysis = job.analysis;
      if (!analysis || analysis.status !== 'DONE') continue; // reste `null`, initialisé ci-dessus.

      const parsedRequirements = jobRequirementsSchema.safeParse(analysis.requirements);
      if (!parsedRequirements.success) {
        // Jamais le contenu des exigences, seulement l'identifiant de l'offre (spec §8).
        this.logger.warn(`Exigences d'analyse invalides pour l'offre ${job.id}, score non calculé.`);
        continue;
      }

      const existing = existingByJobId.get(job.id);
      if (existing && existing.profileFingerprint === fingerprint && existing.analysisVersion === analysis.version) {
        const payload = fromStoredPayload(existing.factors);
        scores[job.id] = { score: existing.score, band: existing.band, priority: existing.priority, explanation: payload.explanation };
        continue;
      }

      const result = scoreJob(inputs, buildJobInputs(job), parsedRequirements.data, now);
      toUpsert.push({ jobId: job.id, result, analysisVersion: analysis.version });
    }

    if (toUpsert.length > 0) {
      await this.prisma.$transaction(
        toUpsert.map(({ jobId, result, analysisVersion }) => {
          const data = {
            score: result.score,
            relevance: result.relevance,
            band: result.band,
            priority: result.priority,
            factors: toStoredPayload(result),
            profileFingerprint: fingerprint,
            analysisVersion,
            computedAt: now,
          };
          return this.prisma.matchScore.upsert({
            where: { profileId_jobId: { profileId, jobId } },
            create: { profileId, jobId, ...data },
            update: data,
          });
        }),
      );
      for (const { jobId, result } of toUpsert) {
        scores[jobId] = { score: result.score, band: result.band, priority: result.priority, explanation: result.explanation };
      }
    }

    return { scores, profileComplete: true };
  }

  /**
   * Score détaillé d'une offre pour l'utilisateur (`GET /jobs/:id/match`) :
   * recalcule si nécessaire (`ensureScores`), puis relit `MatchScore.factors`
   * pour le détail par facteur. `null` seulement si l'offre elle-même
   * n'existe pas (jamais pour un profil incomplet ou une analyse absente,
   * qui sont des états valides du DTO — spec §6).
   */
  async getDetail(userId: string, jobId: string, now: Date = new Date()): Promise<MatchScoreDto | null> {
    const job = await this.prisma.job.findUnique({ where: { id: jobId }, select: { id: true } });
    if (!job) return null;

    const { scores, profileComplete } = await this.ensureScores(userId, [jobId], now);
    const summary = scores[jobId] ?? null;
    const analysisRow = await this.prisma.jobAnalysis.findUnique({ where: { jobId }, select: { status: true, error: true } });
    const analysisStatus = this.resolveAnalysisStatus(analysisRow);

    if (!summary) {
      return {
        score: null,
        band: null,
        priority: null,
        explanation: { top: [], weak: [] },
        factors: [],
        computedAt: null,
        analysis: { status: analysisStatus, error: analysisStatus === 'failed' ? (analysisRow?.error ?? null) : null },
        profileComplete,
        insufficientData: true,
      };
    }

    // `summary` non nul implique un profil complet et une analyse `DONE` valide : la ligne
    // `MatchScore` existe forcément (créée ou réutilisée par `ensureScores` ci-dessus).
    const profile = await this.prisma.profile.findUnique({ where: { userId }, select: { id: true } });
    const matchScoreRow = profile
      ? await this.prisma.matchScore.findUnique({ where: { profileId_jobId: { profileId: profile.id, jobId } } })
      : null;
    const payload = matchScoreRow ? fromStoredPayload(matchScoreRow.factors) : null;

    return {
      score: summary.score,
      band: summary.band,
      priority: summary.priority,
      explanation: summary.explanation,
      factors: payload?.factors ?? [],
      computedAt: matchScoreRow ? matchScoreRow.computedAt.toISOString() : null,
      analysis: { status: analysisStatus, error: null },
      profileComplete,
      insufficientData: payload?.insufficientData ?? summary.score === null,
    };
  }

  /**
   * Statut d'analyse exposé au détail (spec §6) : sans ligne `JobAnalysis`,
   * distingue « IA non configurée » (rien n'est simulé) de « non analysée
   * pour l'instant » — seule différence avec un simple mappage direct du
   * statut Prisma.
   */
  private resolveAnalysisStatus(row: { status: JobAnalysisStatus } | null): MatchAnalysisStatus {
    if (!row) return this.jobAnalysisService.isConfigured() ? 'none' : 'ai_not_configured';
    if (row.status === 'DONE') return 'done';
    if (row.status === 'PENDING') return 'pending';
    return 'failed';
  }
}
