import { randomUUID } from 'node:crypto';
import { ConflictException, Inject, Injectable, Logger, NotFoundException } from '@nestjs/common';
import Anthropic from '@anthropic-ai/sdk';
import { zodOutputFormat } from '@anthropic-ai/sdk/helpers/zod';
import {
  jobRequirementsSchema,
  resumeTailoringSchema,
  resumeTailoringWireSchema,
  type JobRequirements,
  type ResumeChanges,
  type ResumeContent,
  type ResumeTailoringInput,
} from '@jobtrack/shared';
import type { JobAnalysis } from '@prisma/client';
import { ANTHROPIC_CLIENT, ANTHROPIC_MODEL, type AnthropicClient } from '../../common/anthropic.provider';
import { PrismaService } from '../../common/prisma.service';
import { RedisService } from '../../common/redis.service';
import { computeChanges } from './lib/changes';
import { groundTailoring } from './lib/grounding';
import { AiNotConfiguredError, AiOutputInvalidError, AiUnavailableError, ProfileIncompleteError } from './resume.errors';
import { buildTailoringDocument, RESUME_TAILORING_PROMPT_VERSION, RESUME_TAILORING_SYSTEM_PROMPT, type ResumeJobInput } from './resume-tailoring.prompt';
import { ResumeSourceService } from './resume-source.service';

const LOCK_PREFIX = 'resume:tailor:';
// 2 minutes (spec §5) : couvre largement un appel `messages.parse` normal, sans laisser un
// verrou orphelin bloquer trop longtemps une nouvelle tentative après un crash du processus.
const LOCK_TTL_MS = 120_000;
const MAX_OUTPUT_TOKENS = 8000;

const JOB_NOT_FOUND_MESSAGE = 'Offre introuvable.';
export const TAILORING_IN_PROGRESS_MESSAGE = 'Une adaptation est déjà en cours pour cette offre.';

/** Compare-and-delete : ne libère le verrou que si nous en sommes toujours le propriétaire (`ARGV[1]`). */
const UNLOCK_SCRIPT = `
if redis.call('GET', KEYS[1]) == ARGV[1] then
  return redis.call('DEL', KEYS[1])
end
return 0
`;

type LockResult = { status: 'acquired'; token: string } | { status: 'held' } | { status: 'unavailable' };

// Construit une seule fois : `zodOutputFormat` génère le JSON Schema à l'appel, pas besoin de le
// refaire à chaque adaptation.
const OUTPUT_FORMAT = zodOutputFormat(resumeTailoringWireSchema);

export interface ResumeTailoringResult {
  content: ResumeContent;
  changes: ResumeChanges;
  model: string;
  promptVersion: number;
  inputTokens: number;
  outputTokens: number;
  /** Titre de CV suggéré (« CV {offre} — {entreprise} », spec §2) ; la persistance (tâche 5)
   * reste libre de le reprendre tel quel ou de laisser l'utilisateur le modifier. */
  title: string;
}

interface ClaudeTailoringResult {
  tailoring: ResumeTailoringInput;
  model: string;
  inputTokens: number;
  outputTokens: number;
}

/** Sous-ensemble de `Job` nécessaire à la fois au document envoyé au modèle et au titre suggéré. */
interface TailoringJob extends ResumeJobInput {
  analysis: JobAnalysis | null;
}

/**
 * Adaptation d'un CV à une offre par Claude (spec §5), même socle que l'analyse d'offre
 * (tranche 4) et l'extraction de CV (tranche 2) : `messages.parse` + `zodOutputFormat`, prompt
 * système en cache, verrou Redis par (utilisateur, offre), jetons comptés, aucune écriture en
 * base (persistance laissée à la tâche 5). Ne journalise jamais le contenu du profil, de l'offre
 * ou de l'adaptation — seulement des identifiants, jetons et compteurs.
 */
@Injectable()
export class ResumeTailoringService {
  private readonly logger = new Logger(ResumeTailoringService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly redis: RedisService,
    private readonly resumeSource: ResumeSourceService,
    @Inject(ANTHROPIC_CLIENT) private readonly client: AnthropicClient,
  ) {}

  isConfigured(): boolean {
    return this.client !== null;
  }

  /**
   * Adapte le CV de base de `userId` à l'offre `jobId`. Lève `ProfileIncompleteError` si le
   * profil est absent ou vide (aucune expérience ni compétence) ; `NotFoundException`
   * (`JOB_NOT_FOUND`) si l'offre n'existe pas ; `AiNotConfiguredError`/`AiUnavailableError` selon
   * la cause d'échec Anthropic ; `AiOutputInvalidError` si la sortie du modèle est inexploitable
   * (schéma non respecté, sortie tronquée, refus) — dans tous les cas d'échec, rien n'est écrit en
   * base par ce service. `ConflictException` (`TAILORING_IN_PROGRESS`) si une adaptation pour la
   * même offre est déjà en cours pour cet utilisateur.
   */
  async tailor(userId: string, jobId: string, now: Date = new Date()): Promise<ResumeTailoringResult> {
    const base = await this.resumeSource.loadBase(userId);
    if (!base || !base.complete) throw new ProfileIncompleteError();

    const job = await this.loadJob(jobId);
    if (!job) throw new NotFoundException({ code: 'JOB_NOT_FOUND', message: JOB_NOT_FOUND_MESSAGE });

    const client = this.client;
    if (!client) throw new AiNotConfiguredError();

    const lock = await this.acquireLock(userId, jobId);
    if (lock.status === 'held') {
      throw new ConflictException({ code: 'TAILORING_IN_PROGRESS', message: TAILORING_IN_PROGRESS_MESSAGE });
    }
    const token = lock.status === 'acquired' ? lock.token : null;

    try {
      const requirements = this.parseRequirements(job.analysis);
      const document = buildTailoringDocument({ base: base.aiContent, job, requirements });
      const result = await this.callClaude(client, document);

      const ground = groundTailoring(base.content, result.tailoring);
      const changes = computeChanges(base.content, ground.content, ground.rejected, result.tailoring.notes);

      this.logger.log(
        `Adaptation de CV terminée — offre=${jobId} modèle=${result.model} ` +
          `tokens_entrée=${result.inputTokens} tokens_sortie=${result.outputTokens} ` +
          `puces_rejetees=${ground.rejected.length} horodatage=${now.toISOString()}`,
      );

      return {
        content: ground.content,
        changes,
        model: result.model,
        promptVersion: RESUME_TAILORING_PROMPT_VERSION,
        inputTokens: result.inputTokens,
        outputTokens: result.outputTokens,
        title: this.suggestTitle(job),
      };
    } finally {
      if (token) await this.releaseLock(userId, jobId, token);
    }
  }

  private async loadJob(jobId: string): Promise<TailoringJob | null> {
    const job = await this.prisma.job.findUnique({ where: { id: jobId }, include: { analysis: true } });
    if (!job) return null;
    return {
      title: job.title,
      company: job.company,
      contractLabel: job.contractLabel,
      experienceLabel: job.experienceLabel,
      description: job.description,
      analysis: job.analysis,
    };
  }

  /** `null` si l'offre n'a jamais été analysée, ou si son analyse n'est pas `DONE`, ou si le
   * contenu enregistré ne respecte plus le schéma attendu (défensif) — dans tous ces cas,
   * `buildTailoringDocument` se rabat sur la description brute de l'offre. */
  private parseRequirements(analysis: JobAnalysis | null): JobRequirements | null {
    if (!analysis || analysis.status !== 'DONE') return null;
    const parsed = jobRequirementsSchema.safeParse(analysis.requirements);
    return parsed.success ? parsed.data : null;
  }

  private suggestTitle(job: ResumeJobInput): string {
    return job.company ? `CV ${job.title} — ${job.company}` : `CV ${job.title}`;
  }

  private async callClaude(client: Anthropic, document: string): Promise<ClaudeTailoringResult> {
    // Le cache Anthropic n'active qu'à partir d'un préfixe d'environ 1024 tokens (seuil
    // provisoire, pas de garantie contractuelle) : `RESUME_TAILORING_SYSTEM_PROMPT` doit rester
    // au moins aussi long pour que ce `cache_control` serve à quelque chose.
    const system: Array<Anthropic.TextBlockParam> = [
      { type: 'text', text: RESUME_TAILORING_SYSTEM_PROMPT, cache_control: { type: 'ephemeral' } },
    ];
    const messages: Array<Anthropic.MessageParam> = [{ role: 'user', content: document }];

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
    // structurée ne doit jamais être traitée comme une adaptation exploitable.
    if (response.stop_reason === 'refusal' || response.stop_reason === 'max_tokens' || response.parsed_output === null) {
      throw new AiOutputInvalidError();
    }

    let tailoring: ResumeTailoringInput;
    try {
      tailoring = resumeTailoringSchema.parse(response.parsed_output);
    } catch {
      // Jamais la valeur : la sortie du modèle peut porter n'importe quel fragment du profil ou
      // de l'offre — seule la classe d'erreur (implicite ici : schéma non respecté) est utile.
      this.logger.warn("Sortie d'adaptation de CV incohérente (schéma non respecté).");
      throw new AiOutputInvalidError();
    }

    return {
      tailoring,
      model: response.model,
      inputTokens: response.usage.input_tokens,
      outputTokens: response.usage.output_tokens,
    };
  }

  /**
   * Traduit les erreurs typées du SDK Anthropic en erreurs métier (même mappage que
   * `JobAnalysisService`) ; toute autre erreur (bug, panne non prévue) est repropagée telle
   * quelle.
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
      this.logger.warn("Sortie d'adaptation de CV non interprétable (JSON invalide ou non conforme au schéma).");
      throw new AiOutputInvalidError();
    }
    throw error;
  }

  /** `SET NX PX` avec un jeton propre à cet appel : seul son détenteur pourra le libérer. */
  private async acquireLock(userId: string, jobId: string): Promise<LockResult> {
    const key = this.lockKey(userId, jobId);
    const token = randomUUID();
    try {
      const result = await this.redis.client.set(key, token, 'PX', LOCK_TTL_MS, 'NX');
      return result === 'OK' ? { status: 'acquired', token } : { status: 'held' };
    } catch (error) {
      // Redis indisponible : on ne bloque jamais l'adaptation pour autant — mais sans verrou
      // réel, personne ne le détient : `unavailable`, jamais `acquired` avec un jeton qui ne
      // protégerait rien.
      this.logger.warn(`Verrou d'adaptation indisponible (Redis) pour l'offre ${jobId} : ${this.describeError(error)}`);
      return { status: 'unavailable' };
    }
  }

  private async releaseLock(userId: string, jobId: string, token: string): Promise<void> {
    const key = this.lockKey(userId, jobId);
    try {
      await this.redis.client.eval(UNLOCK_SCRIPT, 1, key, token);
    } catch (error) {
      this.logger.warn(`Libération du verrou d'adaptation impossible pour l'offre ${jobId} : ${this.describeError(error)}`);
    }
  }

  private lockKey(userId: string, jobId: string): string {
    return `${LOCK_PREFIX}${userId}:${jobId}`;
  }

  /** Jamais de `(error as Error)` : une erreur interceptée peut être n'importe quelle valeur
   * (`throw 'texte'`, `throw 42`…), pas seulement une instance d'`Error`. */
  private describeError(error: unknown): string {
    return error instanceof Error ? error.message : 'erreur inconnue';
  }
}
