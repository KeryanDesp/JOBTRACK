import { z } from 'zod';

/**
 * Une variable présente mais vide dans un .env (`GOOGLE_CLIENT_ID=`) est lue
 * comme la chaîne vide, pas comme absente. Pour les variables optionnelles,
 * on normalise la chaîne vide en `undefined` avant validation : sinon
 * `z.string().url().optional()` rejetterait `""` et empêcherait le démarrage.
 */
const emptyToUndefined = (value: unknown): unknown => (value === '' ? undefined : value);

const optionalString = z.preprocess(emptyToUndefined, z.string().optional());
const optionalUrl = z.preprocess(emptyToUndefined, z.string().url().optional());

export const serverEnvSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  API_PORT: z.coerce.number().int().positive().default(3001),
  WEB_ORIGIN: z.string().url(),

  DATABASE_URL: z.string().min(1),
  REDIS_URL: z.string().min(1),

  // 32 caractères minimum : un secret plus court affaiblit la signature de session.
  SESSION_SECRET: z.string().min(32),

  // Optionnels en tranche 0 ; requis dès que Google est branché (tranche 1).
  GOOGLE_CLIENT_ID: optionalString,
  GOOGLE_CLIENT_SECRET: optionalString,
  GOOGLE_CALLBACK_URL: optionalUrl,
});

export type ServerEnv = z.infer<typeof serverEnvSchema>;
