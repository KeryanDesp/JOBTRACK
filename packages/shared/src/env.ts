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

/**
 * Comme `optionalUrl`, mais exige le schéma `https://` : les URL France
 * Travail transportent un secret (jeton, identifiants) et ne doivent jamais
 * pouvoir dégrader vers `http://`, y compris si quelqu'un modifie le `.env`
 * par erreur.
 */
const optionalHttpsUrl = (message: string) =>
  z.preprocess(emptyToUndefined, z.string().url().startsWith('https://', message).optional());

export const serverEnvSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  API_PORT: z.coerce.number().int().positive().default(3001),
  // Sans ce nettoyage, une origine terminée par `/` produirait des redirections du type
  // `http://host//profile` (double slash) partout où le code fait `${WEB_ORIGIN}/chemin`.
  WEB_ORIGIN: z
    .string()
    .trim()
    .url()
    .transform((value) => value.replace(/\/+$/, '')),

  DATABASE_URL: z.string().trim().min(1),
  REDIS_URL: z.string().trim().min(1),

  // 32 caractères minimum : un secret plus court affaiblit la signature de session.
  // `.trim()` avant `.min()` : un secret composé uniquement d'espaces ne doit pas passer.
  SESSION_SECRET: z.string().trim().min(32),

  // Optionnels en tranche 0 ; requis dès que Google est branché (tranche 1).
  GOOGLE_CLIENT_ID: optionalString,
  GOOGLE_CLIENT_SECRET: optionalString,
  GOOGLE_CALLBACK_URL: optionalUrl,

  // Optionnelle : sans clé, le service IA est desactive (capabilities.ai = false).
  ANTHROPIC_API_KEY: optionalString,
  // Le defaut effectif (`claude-opus-5`) est applique par le code consommateur,
  // pas ici, pour rester une simple chaine optionnelle sans logique metier.
  ANTHROPIC_MODEL: optionalString,

  // Racine du stockage disque des fichiers (CV importes). Jamais versionnee.
  STORAGE_DIR: z.string().trim().min(1).default('./storage'),

  // Connecteur France Travail (tranche 3) : optionnels, sans eux le connecteur
  // est « non configure » (aucune offre reelle, l'API demarre quand meme).
  FRANCE_TRAVAIL_CLIENT_ID: optionalString,
  FRANCE_TRAVAIL_CLIENT_SECRET: optionalString,
  // Defauts alignes sur la documentation officielle de l'API « Offres d'emploi v2 ».
  // Pas de `?` dans l'URL de base : le client y ajoute lui-meme ses parametres
  // de requete (`buildUrl`) — une base qui en contiendrait deja produirait une
  // requete corrompue (refuse aussi a la construction du client, en second filet).
  FRANCE_TRAVAIL_API_URL: optionalHttpsUrl('FRANCE_TRAVAIL_API_URL doit commencer par https://.')
    .refine((value) => value === undefined || !value.includes('?'), {
      message: "FRANCE_TRAVAIL_API_URL ne doit pas contenir de paramètres (le client les ajoute lui-même).",
    })
    .transform((value) => value ?? 'https://api.francetravail.io/partenaire/offresdemploi/v2'),
  FRANCE_TRAVAIL_TOKEN_URL: optionalHttpsUrl('FRANCE_TRAVAIL_TOKEN_URL doit commencer par https://.').transform(
    (value) => value ?? 'https://entreprise.francetravail.fr/connexion/oauth2/access_token?realm=%2Fpartenaire',
  ),
  FRANCE_TRAVAIL_SCOPE: optionalString.transform((value) => value ?? 'api_offresdemploiv2 o2dsoffre'),
});

export type ServerEnv = z.infer<typeof serverEnvSchema>;
