import Anthropic from '@anthropic-ai/sdk';
import { type Provider } from '@nestjs/common';
import { env } from '../config/env';

/** Jeton d'injection : `null` quand aucune clé n'est configurée (service IA désactivé). */
export const ANTHROPIC_CLIENT = Symbol('ANTHROPIC_CLIENT');

export type AnthropicClient = Anthropic | null;

/** Modèle utilisé pour l'extraction, avec le défaut de la tranche 2 si non renseigné. */
export const ANTHROPIC_MODEL = env.ANTHROPIC_MODEL ?? 'claude-opus-5';

export const anthropicClientProvider: Provider = {
  provide: ANTHROPIC_CLIENT,
  useFactory: (): AnthropicClient =>
    env.ANTHROPIC_API_KEY
      ? new Anthropic({ apiKey: env.ANTHROPIC_API_KEY, maxRetries: 2, timeout: 90_000 })
      : null,
};
