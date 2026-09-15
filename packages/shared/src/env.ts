import { z } from 'zod';

/**
 * Une variable présente mais vide dans un .env (`GOOGLE_CLIENT_ID=`) est lue
 * comme la chaîne vide, pas comme absente. Pour les variables optionnelles,
 * on normalise la chaîne vide en `undefined` avant validation : sinon
 * `z.string().url().optional()` rejetterait `""` et empêcherait le démarrage.
 */
const emptyToUndefined = (value: unknown): unknown => (value === '' ? undefined : value);

/**
 * `z.preprocess` est réservé aux schémas d'environnement : l'entrée est `process.env`,
 * jamais un littéral typé, donc dégrader son type en `unknown` n'a aucun coût ici.
 * Les futurs schémas de formulaires (consommés par `zodResolver`) doivent, eux,
 * préserver `z.input<>` pour que React Hook Form garde l'inférence de type sur les
 * valeurs de champ — préférer `.transform(...)` ou `.catch(...)` dans ce cas, pas
 * `z.preprocess`.
 */
const optionalString = z.preprocess(emptyToUndefined, z.string().optional());
const optionalUrl = z.preprocess(emptyToUndefined, z.string().url().optional());

export const serverEnvSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  API_PORT: z.coerce.number().int().positive().default(3001),
  WEB_ORIGIN: z.string().trim().url(),

  DATABASE_URL: z.string().trim().min(1),
  REDIS_URL: z.string().trim().min(1),

  // 32 caractères minimum : un secret plus court affaiblit la signature de session.
  // `.trim()` avant `.min()` : un secret composé uniquement d'espaces ne doit pas passer.
  SESSION_SECRET: z.string().trim().min(32),

  // Optionnels en tranche 0 ; requis dès que Google est branché (tranche 1).
  GOOGLE_CLIENT_ID: optionalString,
  GOOGLE_CLIENT_SECRET: optionalString,
  GOOGLE_CALLBACK_URL: optionalUrl,
});

export type ServerEnv = z.infer<typeof serverEnvSchema>;
