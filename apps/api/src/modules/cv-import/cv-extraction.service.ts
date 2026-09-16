import { Inject, Injectable, Logger } from '@nestjs/common';
import Anthropic from '@anthropic-ai/sdk';
import { zodOutputFormat } from '@anthropic-ai/sdk/helpers/zod';
import * as mammoth from 'mammoth';
import { cvExtractionSchema, cvExtractionWireSchema, type CvExtraction } from '@jobtrack/shared';
import { ANTHROPIC_CLIENT, ANTHROPIC_MODEL, type AnthropicClient } from '../../common/anthropic.provider';
import { AiNotConfiguredError, AiUnavailableError, CvTooLongError, CvUnreadableError } from './cv-extraction.errors';
import { CV_EXTRACTION_SYSTEM_PROMPT } from './cv-extraction.prompt';

// Garde-fous avant d'appeler Anthropic : au-dela, la requete est refusee sans
// consommer de quota (spec §5 — « garde de cout »).
const MAX_TEXT_CHARACTERS = 200_000;
const MAX_INPUT_TOKENS = 60_000;
const MAX_OUTPUT_TOKENS = 16_000;

// Construit une seule fois : `zodOutputFormat` genere le JSON Schema a l'appel,
// pas besoin de le refaire a chaque extraction.
const OUTPUT_FORMAT = zodOutputFormat(cvExtractionWireSchema);

export interface CvExtractionInput {
  buffer: Buffer;
  mimeType: 'application/pdf' | 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';
}

export interface CvExtractionResult {
  extraction: CvExtraction;
  model: string;
  inputTokens: number;
  outputTokens: number;
}

/**
 * Extraction structuree d'un CV par Claude : construit le contenu (PDF natif ou
 * texte DOCX via `mammoth`), verifie le cout avant l'appel, puis normalise la
 * sortie via `cvExtractionSchema`. Ne journalise jamais le contenu du document,
 * seulement des identifiants et des compteurs.
 */
@Injectable()
export class CvExtractionService {
  private readonly logger = new Logger(CvExtractionService.name);

  constructor(@Inject(ANTHROPIC_CLIENT) private readonly client: AnthropicClient) {}

  async extract(input: CvExtractionInput): Promise<CvExtractionResult> {
    if (!this.client) throw new AiNotConfiguredError();

    const content = await this.buildContent(input);
    const system: Array<Anthropic.TextBlockParam> = [
      { type: 'text', text: CV_EXTRACTION_SYSTEM_PROMPT, cache_control: { type: 'ephemeral' } },
    ];
    const messages: Array<Anthropic.MessageParam> = [{ role: 'user', content }];

    const tokenCount = await this.client.messages.countTokens({ model: ANTHROPIC_MODEL, system, messages });
    if (tokenCount.input_tokens > MAX_INPUT_TOKENS) throw new CvTooLongError();

    const startedAt = Date.now();
    const response = await this.client.messages
      .parse({
        model: ANTHROPIC_MODEL,
        max_tokens: MAX_OUTPUT_TOKENS,
        thinking: { type: 'adaptive' },
        output_config: { effort: 'medium', format: OUTPUT_FORMAT },
        system,
        messages,
      })
      .catch((error: unknown) => this.handleAnthropicError(error));
    const durationMs = Date.now() - startedAt;

    if (response.stop_reason === 'refusal') {
      throw new CvUnreadableError("Le document n'a pas pu être analysé.");
    }
    if (response.parsed_output === null) {
      throw new CvUnreadableError("Le document n'a pas pu être interprété.");
    }

    const result = cvExtractionSchema.safeParse(response.parsed_output);
    if (!result.success) {
      // Jamais la valeur des champs en erreur : seulement leur chemin, pour diagnostiquer
      // sans risquer de journaliser un fragment de CV.
      const paths = result.error.issues.map((issue) => issue.path.join('.') || '(racine)').join(', ');
      this.logger.warn(`Sortie d'extraction incohérente (chemins en erreur : ${paths}).`);
      throw new CvUnreadableError('Les données extraites sont incohérentes.');
    }

    this.logger.log(
      `Extraction CV terminée — modèle=${response.model} tokens_entrée=${response.usage.input_tokens} ` +
        `tokens_sortie=${response.usage.output_tokens} durée_ms=${durationMs}`,
    );

    return {
      extraction: result.data,
      model: response.model,
      inputTokens: response.usage.input_tokens,
      outputTokens: response.usage.output_tokens,
    };
  }

  /** PDF : envoye tel quel (lecture native par Claude). DOCX : texte extrait par `mammoth`. */
  private async buildContent(input: CvExtractionInput): Promise<Array<Anthropic.ContentBlockParam>> {
    if (input.mimeType === 'application/pdf') {
      return [
        {
          type: 'document',
          source: { type: 'base64', media_type: 'application/pdf', data: input.buffer.toString('base64') },
        },
        { type: 'text', text: 'Extrais les informations de ce CV.' },
      ];
    }

    const extracted = await mammoth.extractRawText({ buffer: input.buffer });
    const text = extracted.value.trim();
    if (text.length === 0) {
      throw new CvUnreadableError('Le document ne contient pas de texte exploitable.');
    }
    if (text.length > MAX_TEXT_CHARACTERS) throw new CvTooLongError();

    return [{ type: 'text', text: `Voici le texte d'un CV, extrais-en les informations :\n\n${text}` }];
  }

  /**
   * Traduit les erreurs typees du SDK Anthropic en erreurs metier ; toute autre
   * erreur (bug, panne non prevue) est repropagee telle quelle.
   */
  private handleAnthropicError(error: unknown): never {
    if (error instanceof Anthropic.AuthenticationError) {
      this.logger.error("Authentification Anthropic refusée (clé invalide ou révoquée).");
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
    if (error instanceof Anthropic.BadRequestError && /document|pdf/i.test(error.message)) {
      throw new CvUnreadableError("Ce PDF n'est pas lisible. Essayez de l'exporter à nouveau ou utilisez un autre fichier.");
    }
    throw error;
  }
}
