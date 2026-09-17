import { randomUUID } from 'node:crypto';
import { ConflictException, Inject, Injectable, Logger, NotFoundException } from '@nestjs/common';
import Anthropic from '@anthropic-ai/sdk';
import { zodOutputFormat } from '@anthropic-ai/sdk/helpers/zod';
import {
  coverLetterContentSchema,
  coverLetterWireSchema,
  jobRequirementsSchema,
  type CoverLetterContent,
  type CoverLetterTone,
  type JobRequirements,
  type ResumeContent,
} from '@jobtrack/shared';
import type { JobAnalysis } from '@prisma/client';
import { ANTHROPIC_CLIENT, ANTHROPIC_MODEL, type AnthropicClient } from '../../common/anthropic.provider';
import { PrismaService } from '../../common/prisma.service';
import { rateLimitKey } from '../../common/rate-limit.guard';
import { RateLimiterService } from '../../common/rate-limiter.service';
import { RedisService } from '../../common/redis.service';
import { buildKnownNumbers, buildKnownTerms, groundLetter } from './lib/grounding';
import { parseAiOutputOrThrow } from './lib/validation';
import { buildLetterDocument, COVER_LETTER_PROMPT_VERSION, COVER_LETTER_SYSTEM_PROMPT, type ResumeJobInput } from './cover-letter.prompt';
import { COVER_LETTER_RATE_LIMIT } from './resume.constants';
import { AiNotConfiguredError, AiOutputInvalidError, AiUnavailableError, ProfileIncompleteError, RateLimitedError } from './resume.errors';
import { ResumeSourceService } from './resume-source.service';

const LOCK_PREFIX = 'resume:letter:';
// Doit couvrir le pire cas d'un appel `messages.parse` côté client Anthropic
// (`anthropic.provider.ts` : `maxRetries: 2`, `timeout: 90_000`) — 1 + 2 tentatives de 90 s au
// pire, soit 270 s — avec une marge (même raison que `resume-tailoring.service.ts`/`LOCK_TTL_MS`).
const LOCK_TTL_MS = 300_000;
// La pensée adaptive (`thinking: { type: 'adaptive' }`) compte dans `max_tokens` : 3000 s'est
// révélé trop serré en pratique (troncatures `stop_reason: 'max_tokens'` sur des lettres pourtant
// courtes) — porté à la même valeur que l'adaptation de CV.
const MAX_OUTPUT_TOKENS = 8000;

const JOB_NOT_FOUND_MESSAGE = 'Offre introuvable.';
export const LETTER_IN_PROGRESS_MESSAGE = 'Une lettre est déjà en cours de génération pour cette offre.';

/** Compare-and-delete : ne libère le verrou que si nous en sommes toujours le propriétaire (`ARGV[1]`). */
const UNLOCK_SCRIPT = `
if redis.call('GET', KEYS[1]) == ARGV[1] then
  return redis.call('DEL', KEYS[1])
end
return 0
`;

type LockResult = { status: 'acquired'; token: string } | { status: 'held' } | { status: 'unavailable' };

// Construit une seule fois : `zodOutputFormat` génère le JSON Schema à l'appel, pas besoin de le
// refaire à chaque lettre.
const OUTPUT_FORMAT = zodOutputFormat(coverLetterWireSchema);

export interface CoverLetterResult {
  content: CoverLetterContent;
  model: string;
  promptVersion: number;
  inputTokens: number;
  outputTokens: number;
}

interface ClaudeLetterResult {
  letter: CoverLetterContent;
  model: string;
  inputTokens: number;
  outputTokens: number;
}

interface LetterJob extends ResumeJobInput {
  analysis: JobAnalysis | null;
}

/**
 * Génération de lettre de motivation par Claude (spec §5), même socle que l'adaptation de CV
 * (`ResumeTailoringService`) : `messages.parse` + `zodOutputFormat`, prompt système en cache,
 * verrou Redis par (utilisateur, offre), jetons comptés, aucune écriture en base ici (persistance
 * réalisée par `CoverLetterStoreService`, qui appelle ce service). Ne journalise jamais le contenu
 * du profil, de l'offre ou de la lettre.
 */
@Injectable()
export class CoverLetterService {
  private readonly logger = new Logger(CoverLetterService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly redis: RedisService,
    private readonly resumeSource: ResumeSourceService,
    private readonly rateLimiter: RateLimiterService,
    @Inject(ANTHROPIC_CLIENT) private readonly client: AnthropicClient,
  ) {}

  /**
   * Génère une lettre de motivation pour `userId` et l'offre `jobId`, dans le ton demandé.
   * `resumeId` (CV adapté déjà enregistré, optionnel) n'influence jamais la génération elle-même
   * — il n'est ici accepté que pour compatibilité avec la signature attendue par
   * `CoverLetterStoreService.create`, qui l'utilise comme clé étrangère `CoverLetter.resumeId`.
   * Mêmes erreurs que `ResumeTailoringService.tailor` (profil incomplet, offre introuvable,
   * service IA non configuré/indisponible, sortie inexploitable, verrou déjà détenu).
   */
  async write(userId: string, jobId: string, tone: CoverLetterTone, resumeId?: string): Promise<CoverLetterResult> {
    const base = await this.resumeSource.loadBase(userId);
    if (!base || !base.complete) throw new ProfileIncompleteError();

    const job = await this.loadJob(jobId);
    if (!job) throw new NotFoundException({ code: 'JOB_NOT_FOUND', message: JOB_NOT_FOUND_MESSAGE });

    const client = this.client;
    if (!client) throw new AiNotConfiguredError();

    const lock = await this.acquireLock(userId, jobId);
    if (lock.status === 'held') {
      throw new ConflictException({ code: 'LETTER_IN_PROGRESS', message: LETTER_IN_PROGRESS_MESSAGE });
    }
    const token = lock.status === 'acquired' ? lock.token : null;

    try {
      const requirements = this.parseRequirements(job.analysis);
      const document = buildLetterDocument({ base: base.aiContent, job, requirements, tone });

      // Compté manuellement, juste avant l'appel Claude (revue sécurité, tâche 5) : jamais par
      // une garde posée sur la route, qui aurait déjà consommé le budget sur la 404/409/503
      // ci-dessus.
      const rateLimitHit = await this.rateLimiter.hit(
        rateLimitKey(COVER_LETTER_RATE_LIMIT.bucket, `user:${userId}`),
        COVER_LETTER_RATE_LIMIT.limit,
        COVER_LETTER_RATE_LIMIT.windowSeconds,
      );
      if (!rateLimitHit.allowed) throw new RateLimitedError();

      const result = await this.callClaude(client, document, jobId);

      const sources = this.collectSources(base.aiContent, job, requirements);
      const knownTerms = buildKnownTerms(base.aiContent);
      const knownNumbers = buildKnownNumbers(base.aiContent);
      const grounded = groundLetter(result.letter, sources, knownTerms, tone, knownNumbers);

      // L'identité du candidat n'est jamais laissée à l'appréciation du modèle : la signature est
      // toujours son prénom et son nom exacts, jamais une reformulation ou une variante possible.
      const fullName = `${base.aiContent.identity.firstName} ${base.aiContent.identity.lastName}`.trim();
      // Le destinataire n'est jamais garanti par l'ancrage lexical (nombres/entités) : un nom de
      // personne bien formé peut échapper à `extractProperNouns` (revue sécurité, tâche 4) —
      // vérifié séparément, ici, contre le texte brut de l'offre ; jamais conservé sinon, même
      // assaini (`groundLetter` l'a déjà nettoyé des caractères de contrôle).
      const recipient = this.recipientAppearsInOffer(grounded.content.recipient, job) ? grounded.content.recipient : null;
      // `parseAiOutputOrThrow` (jamais `.parse` nu, revue sécurité tâche 5) : `signature`/
      // `recipient` réassignés ici pourraient à eux seuls rendre la sortie non conforme au schéma
      // (cas défensif — `fullName` provient du profil, déjà validé, mais jamais garanti non vide
      // par ce schéma-ci) ; toujours un 502 `AI_OUTPUT_INVALID`, jamais une `ZodError` brute (500).
      const content: CoverLetterContent = parseAiOutputOrThrow(coverLetterContentSchema, {
        ...grounded.content,
        recipient,
        signature: fullName,
      });

      this.logger.log(
        `Lettre de motivation générée — offre=${jobId} ton=${tone} modèle=${result.model} ` +
          `tokens_entrée=${result.inputTokens} tokens_sortie=${result.outputTokens} ` +
          `phrases_retirees=${grounded.removedSentences.length} cv_source=${resumeId ?? 'aucun'}`,
      );

      return {
        content,
        model: result.model,
        promptVersion: COVER_LETTER_PROMPT_VERSION,
        inputTokens: result.inputTokens,
        outputTokens: result.outputTokens,
      };
    } finally {
      if (token) await this.releaseLock(userId, jobId, token);
    }
  }

  private async loadJob(jobId: string): Promise<LetterJob | null> {
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

  private parseRequirements(analysis: JobAnalysis | null): JobRequirements | null {
    if (!analysis || analysis.status !== 'DONE') return null;
    const parsed = jobRequirementsSchema.safeParse(analysis.requirements);
    return parsed.success ? parsed.data : null;
  }

  /** `true` seulement si `recipient` (déjà assaini par `groundLetter`) figure littéralement dans
   * le texte brut de l'offre (revue sécurité, tâche 4) : un nom de personne bien formé peut
   * échapper à l'ancrage lexical généraliste (`isGrounded` ne détecte que nombres/entités
   * techniques), donc jamais suffisant seul pour garantir qu'il vient bien de l'offre. */
  private recipientAppearsInOffer(recipient: string | null, job: ResumeJobInput): boolean {
    if (recipient === null) return false;
    const offerText = `${job.title} ${job.company ?? ''} ${job.description}`;
    return offerText.includes(recipient);
  }

  /** Textes source pour l'ancrage de la lettre (spec §5 : « profil + offre ») : tous les champs
   * textuels du CV de base (jamais les coordonnées, déjà absentes de `aiContent`) et ce que
   * l'offre indique (titre, entreprise, description brute ou, si disponible, résumé/technologies/
   * indispensables/atouts de l'analyse structurée). */
  private collectSources(base: ResumeContent, job: ResumeJobInput, requirements: JobRequirements | null): string[] {
    const texts: string[] = [base.summary, job.title, job.company ?? '', job.description];
    if (base.identity.title) texts.push(base.identity.title);

    for (const experience of base.experiences) {
      texts.push(experience.role, experience.company, ...experience.highlights);
      if (experience.location) texts.push(experience.location);
      if (experience.sourceDescription) texts.push(experience.sourceDescription);
    }
    for (const education of base.educations) {
      texts.push(education.school, education.degree);
      if (education.field) texts.push(education.field);
    }
    for (const certification of base.certifications) texts.push(certification.name, certification.issuer);
    for (const project of base.projects) {
      texts.push(project.name, ...project.technologies);
      if (project.description) texts.push(project.description);
    }
    for (const skill of base.skills) texts.push(skill.name);
    for (const language of base.languages) texts.push(language.name);

    if (requirements) {
      texts.push(requirements.summary);
      texts.push(...requirements.technologies.map((technology) => technology.name));
      texts.push(...requirements.mustHaves, ...requirements.niceToHaves, ...requirements.softSkills, ...requirements.educationFields);
      texts.push(...requirements.languages.map((language) => language.name));
    }

    return texts;
  }

  private async callClaude(client: Anthropic, document: string, jobId: string): Promise<ClaudeLetterResult> {
    // Le cache Anthropic ne semble s'activer qu'au-delà d'un préfixe de l'ordre de 1024 tokens
    // (comportement observé, non garanti par la documentation) : `COVER_LETTER_SYSTEM_PROMPT`
    // doit rester au moins aussi long pour que ce `cache_control` ait une chance de servir.
    const system: Array<Anthropic.TextBlockParam> = [
      { type: 'text', text: COVER_LETTER_SYSTEM_PROMPT, cache_control: { type: 'ephemeral' } },
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

    // Jetons de cache lus (jamais le contenu) : confirme si le prompt système en cache a
    // effectivement servi pour cet appel — utile au diagnostic, jamais nécessaire au comportement.
    this.logger.debug(`Cache Anthropic — offre=${jobId} tokens_lus=${response.usage.cache_read_input_tokens ?? 0}`);

    if (response.stop_reason === 'refusal' || response.stop_reason === 'max_tokens' || response.parsed_output === null) {
      throw new AiOutputInvalidError();
    }

    const parsed = coverLetterContentSchema.safeParse(response.parsed_output);
    if (!parsed.success) {
      const paths = parsed.error.issues.map((issue) => issue.path.join('.') || '(racine)').join(', ');
      this.logger.warn(`Sortie de lettre incohérente (chemins en erreur : ${paths}).`);
      throw new AiOutputInvalidError();
    }

    return {
      letter: parsed.data,
      model: response.model,
      inputTokens: response.usage.input_tokens,
      outputTokens: response.usage.output_tokens,
    };
  }

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
    if (error instanceof Anthropic.AnthropicError && !(error instanceof Anthropic.APIError)) {
      this.logger.warn('Sortie de lettre non interprétable (JSON invalide ou non conforme au schéma).');
      throw new AiOutputInvalidError();
    }
    throw error;
  }

  private async acquireLock(userId: string, jobId: string): Promise<LockResult> {
    const key = this.lockKey(userId, jobId);
    const token = randomUUID();
    try {
      const result = await this.redis.client.set(key, token, 'PX', LOCK_TTL_MS, 'NX');
      return result === 'OK' ? { status: 'acquired', token } : { status: 'held' };
    } catch (error) {
      this.logger.warn(`Verrou de lettre indisponible (Redis) pour l'offre ${jobId} : ${this.describeError(error)}`);
      return { status: 'unavailable' };
    }
  }

  private async releaseLock(userId: string, jobId: string, token: string): Promise<void> {
    const key = this.lockKey(userId, jobId);
    try {
      await this.redis.client.eval(UNLOCK_SCRIPT, 1, key, token);
    } catch (error) {
      this.logger.warn(`Libération du verrou de lettre impossible pour l'offre ${jobId} : ${this.describeError(error)}`);
    }
  }

  private lockKey(userId: string, jobId: string): string {
    return `${LOCK_PREFIX}${userId}:${jobId}`;
  }

  private describeError(error: unknown): string {
    return error instanceof Error ? error.message : 'erreur inconnue';
  }
}
