import { randomUUID } from 'node:crypto';
import { ConflictException, Inject, Injectable, Logger } from '@nestjs/common';
import Anthropic from '@anthropic-ai/sdk';
import { zodOutputFormat } from '@anthropic-ai/sdk/helpers/zod';
import { Prisma, type JobAnalysis, type JobAnalysisStatus } from '@prisma/client';
import { jobRequirementsSchema, jobRequirementsWireSchema, type JobRequirements } from '@jobtrack/shared';
import { ANTHROPIC_CLIENT, ANTHROPIC_MODEL, type AnthropicClient } from '../../common/anthropic.provider';
import { PrismaService } from '../../common/prisma.service';
import { RedisService } from '../../common/redis.service';
import {
  AiNotConfiguredError,
  AiUnavailableError,
  JOB_ANALYSIS_FAILED_MESSAGE,
  JobAnalysisFailedError,
} from './job-analysis.errors';
import {
  buildOfferDocument,
  JOB_ANALYSIS_SYSTEM_PROMPT,
  JOB_ANALYSIS_VERSION,
  type JobAnalysisOfferInput,
} from './job-analysis.prompt';

const LOCK_PREFIX = 'matching:analysis:';
// Doit couvrir le pire cas d'un appel `messages.parse` côté client Anthropic
// (`anthropic.provider.ts` : `maxRetries: 2`, `timeout: 90_000`) — 1 + 2 tentatives de 90 s
// au pire, soit 270 s — avec une marge : un verrou plus court expirerait avant la fin d'un
// appel légitime et laisserait un second appelant démarrer une analyse concurrente. Le seuil
// de péremption d'un `PENDING` ci-dessous est aligné sur la même durée pour la même raison.
const LOCK_TTL_MS = 300_000;
const STALE_PENDING_MS = 5 * 60 * 1000;
const MAX_OUTPUT_TOKENS = 4000;
// Budget par appel (spec §4 : 20 offres par appel `POST /jobs/analyses`) : plafond dur, jamais
// dépassé même si l'appelant (bug, évolution future) demande une `limit` plus grande.
export const MAX_ANALYSES_PER_CALL = 20;

const JOB_NOT_FOUND_MESSAGE = 'Offre introuvable.';

/** Compare-and-delete : ne libère le verrou que si nous en sommes toujours le propriétaire (`ARGV[1]`). */
const UNLOCK_SCRIPT = `
if redis.call('GET', KEYS[1]) == ARGV[1] then
  return redis.call('DEL', KEYS[1])
end
return 0
`;

type LockResult = { status: 'acquired'; token: string } | { status: 'held' } | { status: 'unavailable' };

export type JobAnalysisOutcomeStatus = 'done' | 'failed' | 'skipped_pending' | 'skipped_done' | 'skipped_failed';

export interface JobAnalysisOutcome {
  status: JobAnalysisOutcomeStatus;
  error?: string;
}

export interface JobAnalysisManyResult {
  done: number;
  failed: number;
  skipped: number;
  pending: number;
}

// Construit une seule fois : `zodOutputFormat` génère le JSON Schema à l'appel, pas besoin
// de le refaire à chaque analyse.
const OUTPUT_FORMAT = zodOutputFormat(jobRequirementsWireSchema);

interface ClaudeAnalysisResult {
  requirements: JobRequirements;
  model: string;
  inputTokens: number;
  outputTokens: number;
}

/**
 * Analyse structurée d'une offre par Claude (spec §4), sur le même socle que l'extraction de
 * CV (`messages.parse` + `zodOutputFormat`, prompt système en cache) : une seule fois par offre
 * et par version de prompt/schéma, indépendante de l'utilisateur, protégée par un verrou Redis
 * contre les analyses concurrentes de la même offre. Ne journalise jamais le contenu de l'offre
 * ni les exigences extraites — seulement des identifiants, statuts et compteurs.
 */
@Injectable()
export class JobAnalysisService {
  private readonly logger = new Logger(JobAnalysisService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly redis: RedisService,
    @Inject(ANTHROPIC_CLIENT) private readonly client: AnthropicClient,
  ) {}

  isConfigured(): boolean {
    return this.client !== null;
  }

  /**
   * Analyse une offre si nécessaire : `skipped_done` si déjà `DONE` à la version courante,
   * `skipped_failed` si déjà `FAILED` à la version courante (jamais rejouée automatiquement —
   * seul `retry` la relance explicitement), `skipped_pending` si une analyse récente (< 5 min)
   * est en cours ailleurs ou si le verrou est détenu par un autre appelant. Ne lève jamais
   * d'exception pour une offre introuvable (jamais de 500) ; lève
   * `AiNotConfiguredError`/`AiUnavailableError` pour que l'appelant les mappe en 503 — dans ces
   * deux cas, aucune trace de cet appel ne subsiste (rollback).
   */
  async analyze(jobId: string, now: Date = new Date()): Promise<JobAnalysisOutcome> {
    return this.runAnalysis(jobId, now, false);
  }

  /** `force` n'est jamais exposé publiquement : seul `retry` (sur une analyse déjà `FAILED`,
   * garde vérifiée avant l'appel) contourne ainsi le garde-fou anti-rejeu de `runAnalysis`. */
  private async runAnalysis(jobId: string, now: Date, force: boolean): Promise<JobAnalysisOutcome> {
    const job = await this.prisma.job.findUnique({
      where: { id: jobId },
      include: { skills: true, requirements: true },
    });
    if (!job) return { status: 'failed', error: JOB_NOT_FOUND_MESSAGE };

    const existing = await this.prisma.jobAnalysis.findUnique({ where: { jobId } });
    if (existing && existing.status === 'DONE' && existing.version === JOB_ANALYSIS_VERSION) {
      return { status: 'skipped_done' };
    }
    if (
      existing &&
      existing.status === 'FAILED' &&
      existing.version === JOB_ANALYSIS_VERSION &&
      !force
    ) {
      return { status: 'skipped_failed', error: existing.error ?? JOB_ANALYSIS_FAILED_MESSAGE };
    }
    if (existing && existing.status === 'PENDING' && now.getTime() - existing.updatedAt.getTime() < STALE_PENDING_MS) {
      return { status: 'skipped_pending' };
    }

    const client = this.client;
    if (!client) throw new AiNotConfiguredError();

    const lock = await this.acquireLock(jobId);
    if (lock.status === 'held') return { status: 'skipped_pending' };
    const token = lock.status === 'acquired' ? lock.token : null;

    try {
      await this.prisma.jobAnalysis.upsert({
        where: { jobId },
        create: { jobId, status: 'PENDING', version: JOB_ANALYSIS_VERSION },
        update: { status: 'PENDING', version: JOB_ANALYSIS_VERSION },
      });

      try {
        const offer: JobAnalysisOfferInput = {
          title: job.title,
          company: job.company,
          description: job.description,
          experienceLabel: job.experienceLabel,
          contractLabel: job.contractLabel,
          workingTimeLabel: job.workingTimeLabel,
          sectorLabel: job.sectorLabel,
          skills: job.skills.map((skill) => ({ name: skill.name, required: skill.required })),
          requirements: job.requirements.map((requirement) => ({
            kind: requirement.kind,
            label: requirement.label,
            required: requirement.required,
          })),
        };
        const result = await this.callClaude(client, offer);

        await this.prisma.jobAnalysis.update({
          where: { jobId },
          data: {
            status: 'DONE',
            version: JOB_ANALYSIS_VERSION,
            requirements: this.toJson(result.requirements),
            model: result.model,
            inputTokens: result.inputTokens,
            outputTokens: result.outputTokens,
            error: null,
            analyzedAt: now,
          },
        });
        this.logger.log(
          `Analyse d'offre terminée — offre=${jobId} modèle=${result.model} ` +
            `tokens_entrée=${result.inputTokens} tokens_sortie=${result.outputTokens}`,
        );
        return { status: 'done' };
      } catch (error) {
        if (error instanceof AiNotConfiguredError || error instanceof AiUnavailableError) {
          await this.rollbackPending(jobId, existing);
          throw error;
        }
        // Bug, schéma non respecté, refus ou sortie tronquée : jamais la valeur ni le message
        // brut de l'erreur (peut porter un fragment de la sortie du modèle), seulement sa classe.
        const errorClass = error instanceof Error ? error.constructor.name : typeof error;
        this.logger.warn(`Analyse de l'offre ${jobId} en échec (${errorClass}).`);
        await this.prisma.jobAnalysis.update({
          where: { jobId },
          data: {
            status: 'FAILED',
            version: JOB_ANALYSIS_VERSION,
            error: JOB_ANALYSIS_FAILED_MESSAGE,
            // Efface tout résultat antérieur (`DONE` d'une version plus ancienne, par exemple) :
            // un `FAILED` à la version courante ne doit jamais laisser croire, via des champs
            // orphelins, qu'une analyse aboutie de cette version existe.
            requirements: Prisma.DbNull,
            model: null,
            inputTokens: null,
            outputTokens: null,
            analyzedAt: null,
          },
        });
        return { status: 'failed', error: JOB_ANALYSIS_FAILED_MESSAGE };
      }
    } finally {
      if (token) await this.releaseLock(jobId, token);
    }
  }

  /**
   * Analyse séquentiellement (jamais en parallèle : un budget d'appels Anthropic partagé et un
   * verrou par offre suffisent, pas besoin de plus de débit ici). S'arrête et repropage dès
   * qu'une offre lève `AiNotConfiguredError`/`AiUnavailableError` — les offres restantes ne sont
   * jamais tentées, ce qui les laisse simplement non comptées. `options.limit` ne peut jamais
   * dépasser `MAX_ANALYSES_PER_CALL` (plafond dur) ; sans `limit`, ce plafond sert de défaut.
   */
  async analyzeMany(jobIds: readonly string[], options: { limit?: number } = {}): Promise<JobAnalysisManyResult> {
    const limit = Math.min(options.limit ?? MAX_ANALYSES_PER_CALL, MAX_ANALYSES_PER_CALL);
    const ids = jobIds.slice(0, limit);
    const counts: JobAnalysisManyResult = { done: 0, failed: 0, skipped: 0, pending: 0 };

    for (const jobId of ids) {
      const outcome = await this.analyze(jobId);
      switch (outcome.status) {
        case 'done':
          counts.done += 1;
          break;
        case 'failed':
          counts.failed += 1;
          break;
        case 'skipped_done':
        case 'skipped_failed':
          counts.skipped += 1;
          break;
        case 'skipped_pending':
          counts.pending += 1;
          break;
      }
    }

    return counts;
  }

  /** Relance une analyse en échec ; refuse toute autre statut (déjà `DONE`/`PENDING`, ou
   * inexistante). Seul appelant à passer `force: true` à `runAnalysis` : la garde ci-dessus
   * (statut `FAILED` déjà vérifié) est le seul cas où contourner le garde-fou anti-rejeu est sûr. */
  async retry(jobId: string): Promise<JobAnalysisOutcome> {
    const existing = await this.prisma.jobAnalysis.findUnique({ where: { jobId } });
    if (!existing || existing.status !== 'FAILED') {
      throw new ConflictException({
        code: 'ANALYSIS_NOT_RETRYABLE',
        message: 'Seule une analyse en échec peut être relancée.',
      });
    }
    return this.runAnalysis(jobId, new Date(), true);
  }

  /** Lecture bon marché (projection minimale) : `null` pour une offre jamais analysée. */
  async getStatus(jobIds: readonly string[]): Promise<Map<string, JobAnalysisStatus | null>> {
    const rows = await this.prisma.jobAnalysis.findMany({
      where: { jobId: { in: [...jobIds] } },
      select: { jobId: true, status: true },
    });
    const statuses = new Map(rows.map((row): [string, JobAnalysisStatus] => [row.jobId, row.status]));
    const result = new Map<string, JobAnalysisStatus | null>();
    for (const jobId of jobIds) result.set(jobId, statuses.get(jobId) ?? null);
    return result;
  }

  private async callClaude(client: Anthropic, offer: JobAnalysisOfferInput): Promise<ClaudeAnalysisResult> {
    // Le cache Anthropic n'active qu'à partir d'un préfixe d'environ 1024 tokens (seuil
    // provisoire, pas de garantie contractuelle) : `JOB_ANALYSIS_SYSTEM_PROMPT` doit rester au
    // moins aussi long pour que ce `cache_control` serve à quelque chose.
    const system: Array<Anthropic.TextBlockParam> = [
      { type: 'text', text: JOB_ANALYSIS_SYSTEM_PROMPT, cache_control: { type: 'ephemeral' } },
    ];
    const messages: Array<Anthropic.MessageParam> = [{ role: 'user', content: buildOfferDocument(offer) }];

    const response = await client.messages
      .parse({
        model: ANTHROPIC_MODEL,
        max_tokens: MAX_OUTPUT_TOKENS,
        thinking: { type: 'adaptive' },
        output_config: { effort: 'medium', format: OUTPUT_FORMAT },
        system,
        messages,
      })
      .catch((error: unknown) => this.handleAnthropicError(error));

    // Une sortie tronquée par la limite de tokens, un refus du modèle, ou l'absence de sortie
    // structurée ne doit jamais être traitée comme une analyse complète.
    if (response.stop_reason === 'refusal' || response.stop_reason === 'max_tokens' || response.parsed_output === null) {
      throw new JobAnalysisFailedError();
    }

    const parsed = jobRequirementsSchema.safeParse(response.parsed_output);
    if (!parsed.success) {
      // Jamais la valeur des champs en erreur : seulement leur chemin, pour diagnostiquer sans
      // risquer de journaliser un fragment des exigences extraites.
      const paths = parsed.error.issues.map((issue) => issue.path.join('.') || '(racine)').join(', ');
      this.logger.warn(`Sortie d'analyse incohérente (chemins en erreur : ${paths}).`);
      throw new JobAnalysisFailedError();
    }

    return {
      requirements: parsed.data,
      model: response.model,
      inputTokens: response.usage.input_tokens,
      outputTokens: response.usage.output_tokens,
    };
  }

  /**
   * Traduit les erreurs typées du SDK Anthropic en erreurs métier ; toute autre erreur (bug,
   * panne non prévue) est repropagée telle quelle.
   */
  private handleAnthropicError(error: unknown): never {
    if (error instanceof Anthropic.AuthenticationError) {
      this.logger.error('Authentification Anthropic refusée (clé invalide ou révoquée).');
      throw new AiNotConfiguredError();
    }
    if (error instanceof Anthropic.PermissionDeniedError) {
      this.logger.error('Accès Anthropic refusé (permissions insuffisantes).');
      throw new AiNotConfiguredError();
    }
    if (error instanceof Anthropic.NotFoundError) {
      // Le plus souvent : `ANTHROPIC_MODEL` pointe vers un identifiant de modèle inexistant.
      this.logger.error(`Modèle Anthropic introuvable (ANTHROPIC_MODEL=${ANTHROPIC_MODEL}).`);
      throw new AiNotConfiguredError();
    }
    if (
      error instanceof Anthropic.RateLimitError ||
      error instanceof Anthropic.InternalServerError ||
      error instanceof Anthropic.APIConnectionError
    ) {
      throw new AiUnavailableError();
    }
    if (error instanceof Anthropic.APIError && error.status !== undefined && (error.status === 429 || error.status >= 500)) {
      throw new AiUnavailableError();
    }
    // `zodOutputFormat(...).parse` lève une `Anthropic.AnthropicError` nue (pas une `APIError`)
    // quand la sortie JSON est tronquée ou ne respecte pas le schéma fil attendu. Ne jamais
    // interpoler `error.message`, qui peut contenir un fragment de la sortie du modèle.
    if (error instanceof Anthropic.AnthropicError && !(error instanceof Anthropic.APIError)) {
      this.logger.warn("Sortie d'analyse non interprétable (JSON invalide ou non conforme au schéma).");
      throw new JobAnalysisFailedError();
    }
    throw error;
  }

  /** `SET NX PX` avec un jeton propre à cet appel : seul son détenteur pourra le libérer. */
  private async acquireLock(jobId: string): Promise<LockResult> {
    const key = `${LOCK_PREFIX}${jobId}`;
    const token = randomUUID();
    try {
      const result = await this.redis.client.set(key, token, 'PX', LOCK_TTL_MS, 'NX');
      return result === 'OK' ? { status: 'acquired', token } : { status: 'held' };
    } catch (error) {
      // Redis indisponible : on ne bloque jamais l'analyse pour autant — mais sans verrou réel,
      // personne ne le détient : `unavailable`, jamais `acquired` avec un jeton qui ne protégerait rien.
      this.logger.warn(`Verrou d'analyse indisponible (Redis) pour l'offre ${jobId} : ${this.describeError(error)}`);
      return { status: 'unavailable' };
    }
  }

  private async releaseLock(jobId: string, token: string): Promise<void> {
    const key = `${LOCK_PREFIX}${jobId}`;
    try {
      await this.redis.client.eval(UNLOCK_SCRIPT, 1, key, token);
    } catch (error) {
      this.logger.warn(`Libération du verrou d'analyse impossible pour l'offre ${jobId} : ${this.describeError(error)}`);
    }
  }

  /**
   * Annule l'effet du `PENDING` posé par cet appel : supprime la ligne si elle n'existait pas
   * avant (`previous === null`), la restaure telle quelle sinon (ancienne analyse `DONE` d'une
   * version antérieure, par exemple) — jamais de trace d'une analyse qui n'a pas abouti.
   */
  private async rollbackPending(jobId: string, previous: JobAnalysis | null): Promise<void> {
    try {
      if (!previous) {
        await this.prisma.jobAnalysis.delete({ where: { jobId } });
        return;
      }
      await this.prisma.jobAnalysis.update({
        where: { jobId },
        data: {
          status: previous.status,
          version: previous.version,
          requirements: previous.requirements === null ? Prisma.DbNull : (previous.requirements as Prisma.InputJsonValue),
          model: previous.model,
          inputTokens: previous.inputTokens,
          outputTokens: previous.outputTokens,
          error: previous.error,
          analyzedAt: previous.analyzedAt,
        },
      });
    } catch (error) {
      this.logger.warn(`Retour arrière de l'analyse impossible pour l'offre ${jobId} : ${this.describeError(error)}`);
    }
  }

  /** Sérialisation documentée pour un `Prisma.InputJsonValue` : les exigences ne sont que des
   * chaînes/nombres/booléens/tableaux/objets imbriqués, jamais de `Date` ni de fonction. */
  private toJson(requirements: JobRequirements): Prisma.InputJsonValue {
    return JSON.parse(JSON.stringify(requirements)) as Prisma.InputJsonValue;
  }

  /** Jamais de `(error as Error)` : une erreur interceptée peut être n'importe quelle valeur
   * (`throw 'texte'`, `throw 42`…), pas seulement une instance d'`Error`. */
  private describeError(error: unknown): string {
    return error instanceof Error ? error.message : 'erreur inconnue';
  }
}
