import { z } from 'zod';

/**
 * Texte optionnel de formulaire. `''` ou `null` signifient « effacer » et
 * deviennent `null` (colonne nullable) ; une clé absente reste `undefined`
 * (inchangée). `'   '` est aussi traité comme une effacement : le `.trim()`
 * de la branche chaîne produit `''`, que la transformation reconnaît ensuite.
 * `null` est accepté en entrée (élargissement — la sortie reste inchangée)
 * pour qu'un brouillon d'extraction de CV, qui émet `null` plutôt que `''`
 * pour un champ vide, s'applique directement avec ce même schéma.
 */
export const optionalText = (max: number) =>
  z
    .union([z.literal(''), z.null(), z.string().trim().max(max, `Maximum ${max} caractères.`)])
    .optional()
    .transform((value) => (value === '' || value === null ? null : value));

/**
 * URL optionnelle de formulaire : mêmes règles que optionalText (`''` ou `null`
 * → `null`, absente → `undefined`), avec validation d'URL et un schéma restreint
 * à http(s) sur la branche non vide — un `javascript:` ou `data:` bien formé
 * pour `new URL()` mais dangereux une fois affiché en lien cliquable ne doit
 * jamais être accepté.
 */
export const optionalUrl = z
  .union([
    z.literal(''),
    z.null(),
    z
      .string()
      .max(2000, 'Maximum 2000 caractères.')
      .url('URL invalide.')
      .refine((value) => /^https?:$/.test(new URL(value).protocol), 'URL invalide.'),
  ])
  .optional()
  .transform((value) => (value === '' || value === null ? null : value));

/**
 * Nombre optionnel saisi dans un formulaire. `''` signifie « effacer » et devient
 * `null` (colonne nullable), comme optionalText ; une clé absente reste `undefined`
 * (inchangée). Seuls un nombre ou une chaîne de chiffres sont acceptés : pas de
 * `z.coerce.number()`, dont la coercion implicite transformerait `true`/`false`/`[]`
 * en 1/0 sans qu'aucune saisie utilisateur ne produise jamais ces valeurs. Pas de
 * `z.preprocess` non plus, pour que `z.input` reste `'' | number | string`,
 * exploitable côté React Hook Form.
 */
export const optionalNumber = (max: number) =>
  z
    .union([
      z.literal(''),
      z.number().int().min(0, 'Valeur invalide.').max(max, `Maximum ${max}.`),
      z
        .string()
        .regex(/^\d+$/, 'Valeur invalide.')
        .transform(Number)
        .pipe(z.number().int().min(0, 'Valeur invalide.').max(max, `Maximum ${max}.`)),
    ])
    .optional()
    .transform((value) => (value === '' ? null : value));

/**
 * Zod ajoute au résultat une clé dont la valeur transformée vaut `undefined`
 * dès lors que la clé existait dans l'entrée brute (ex. `{ yearsExperience: '' }`
 * devient en sortie `{ yearsExperience: undefined }`, la clé reste présente,
 * cf. `alwaysSet` dans ParseStatus.mergeObjectSync). On la retire pour qu'un
 * champ numérique vidé par l'utilisateur soit indiscernable d'une clé omise
 * (sémantique PATCH : omis = inchangé). Ne change rien pour les clés déjà
 * absentes ou dont la valeur est définie.
 */
export function omitUndefinedValues<T extends Record<string, unknown>>(value: T): T {
  const result = { ...value };
  for (const key of Object.keys(result) as (keyof T)[]) {
    if (result[key] === undefined) delete result[key];
  }
  return result;
}

// Date calendaire au format AAAA-MM-JJ uniquement : les colonnes sont en @db.Date,
// et accepter un datetime avec fuseau réintroduirait l'ambiguïté « quel minuit ».
const isoDate = z.string().date('Date invalide (AAAA-MM-JJ attendu).');

export const profileSchema = z
  .object({
    firstName: z.string().trim().min(1, 'Ce champ est obligatoire.').max(80),
    lastName: z.string().trim().min(1, 'Ce champ est obligatoire.').max(80),
    phone: optionalText(30),
    city: optionalText(80),
    country: optionalText(80),
    title: optionalText(120),
    summary: optionalText(2000),
    yearsExperience: optionalNumber(60),
  })
  .transform(omitUndefinedValues);

export const jobPreferencesSchema = z
  .object({
    desiredRoles: z.array(z.string().trim().min(1).max(80)).max(10),
    desiredCategories: z.array(z.string().trim().min(1).max(80)).max(10),
    salaryMin: optionalNumber(1_000_000),
    salaryMax: optionalNumber(1_000_000),
    // Pas de `.default('EUR')` : la colonne Prisma porte déjà ce défaut à la création,
    // et un défaut ici réinjecterait 'EUR' à chaque PATCH omettant `currency`, effaçant
    // silencieusement une devise déjà enregistrée.
    currency: z.string().length(3).optional(),
    locations: z.array(z.string().trim().min(1).max(80)).max(10),
    // Idem : `?? 25` forçait 25 dès que la clé était omise, réinitialisant un rayon
    // déjà enregistré à chaque PATCH partiel. Le défaut (25) ne vit plus qu'en base.
    searchRadiusKm: optionalNumber(500),
    remoteModes: z.array(z.enum(['ONSITE', 'HYBRID', 'REMOTE'])),
    contractTypes: z.array(
      z.enum(['CDI', 'CDD', 'INTERIM', 'INTERNSHIP', 'APPRENTICESHIP', 'FREELANCE', 'PART_TIME']),
    ),
    availability: optionalText(80),
    experienceLevel: z.enum(['STUDENT', 'JUNIOR', 'MID', 'SENIOR', 'LEAD']).optional(),
  })
  // `null` (champ effacé) compte comme « rien à comparer », au même titre que `undefined`
  // (champ omis) : optionalNumber peut désormais produire les deux.
  .refine(
    (value) =>
      value.salaryMin === undefined ||
      value.salaryMin === null ||
      value.salaryMax === undefined ||
      value.salaryMax === null ||
      value.salaryMin <= value.salaryMax,
    { message: 'Le salaire minimum doit être inférieur au maximum.', path: ['salaryMax'] },
  )
  .transform(omitUndefinedValues);

export const experienceSchema = z
  .object({
    company: z.string().trim().min(1, 'Ce champ est obligatoire.').max(120),
    role: z.string().trim().min(1, 'Ce champ est obligatoire.').max(120),
    location: optionalText(120),
    startDate: isoDate,
    endDate: isoDate.optional().nullable(),
    isCurrent: z.boolean().default(false),
    description: optionalText(2000),
  })
  .refine((value) => value.isCurrent || value.endDate, {
    message: 'Indiquez une date de fin ou cochez « poste actuel ».',
    path: ['endDate'],
  })
  // Comparaison lexicale valide : les dates sont au format AAAA-MM-JJ.
  .refine((value) => !value.endDate || value.startDate <= value.endDate, {
    message: 'La date de fin doit être postérieure à la date de début.',
    path: ['endDate'],
  })
  // La base ne doit jamais contenir un poste actuel avec une date de fin.
  .transform((value) => (value.isCurrent ? { ...value, endDate: null } : value));

export const educationSchema = z
  .object({
    school: z.string().trim().min(1, 'Ce champ est obligatoire.').max(120),
    degree: z.string().trim().min(1, 'Ce champ est obligatoire.').max(120),
    field: optionalText(120),
    startDate: isoDate,
    endDate: isoDate.optional().nullable(),
    description: optionalText(2000),
  })
  // Comparaison lexicale valide : les dates sont au format AAAA-MM-JJ.
  .refine((value) => !value.endDate || value.startDate <= value.endDate, {
    message: 'La date de fin doit être postérieure à la date de début.',
    path: ['endDate'],
  });

export const skillSchema = z.object({
  name: z.string().trim().min(1, 'Ce champ est obligatoire.').max(60),
  category: z.enum(['TECHNICAL', 'SOFT', 'TOOL', 'OTHER']).default('TECHNICAL'),
  level: z.enum(['BEGINNER', 'INTERMEDIATE', 'ADVANCED', 'EXPERT']).default('INTERMEDIATE'),
});

export const languageSchema = z.object({
  name: z.string().trim().min(1, 'Ce champ est obligatoire.').max(60),
  level: z.enum(['A1', 'A2', 'B1', 'B2', 'C1', 'C2', 'NATIVE']),
});

export const certificationSchema = z
  .object({
    name: z.string().trim().min(1, 'Ce champ est obligatoire.').max(120),
    issuer: z.string().trim().min(1, 'Ce champ est obligatoire.').max(120),
    issuedAt: isoDate,
    expiresAt: isoDate.optional().nullable(),
    credentialUrl: optionalUrl,
  })
  // Comparaison lexicale valide : les dates sont au format AAAA-MM-JJ.
  .refine((value) => !value.expiresAt || value.issuedAt <= value.expiresAt, {
    message: "La date d'expiration doit être postérieure à la date d'obtention.",
    path: ['expiresAt'],
  });

export const projectSchema = z.object({
  name: z.string().trim().min(1, 'Ce champ est obligatoire.').max(120),
  description: optionalText(2000),
  url: optionalUrl,
  technologies: z.array(z.string().trim().min(1).max(80)).max(20).default([]),
});

export const reorderSchema = z.object({
  ids: z
    .array(z.string().cuid())
    .min(1)
    .max(100)
    .refine((ids) => new Set(ids).size === ids.length, { message: 'Identifiants en double.' }),
});

export type ProfileInput = z.infer<typeof profileSchema>;
export type JobPreferencesInput = z.infer<typeof jobPreferencesSchema>;
export type ExperienceInput = z.infer<typeof experienceSchema>;
export type EducationInput = z.infer<typeof educationSchema>;
export type SkillInput = z.infer<typeof skillSchema>;
export type LanguageInput = z.infer<typeof languageSchema>;
export type CertificationInput = z.infer<typeof certificationSchema>;
export type ProjectInput = z.infer<typeof projectSchema>;
export type ReorderInput = z.infer<typeof reorderSchema>;

/**
 * Les types ci-dessus (`z.infer` = type de *sortie*) décrivent ce que Zod
 * produit après validation — champs par défaut posés (`category`,
 * `isCurrent`, `technologies`…), `''` déjà transformé en `null`. Ils ne
 * conviennent pas pour typer ce qu'un formulaire envoie : un champ avec
 * `.default()` y est optionnel en entrée mais obligatoire en sortie, et un
 * champ texte optionnel y accepte encore `''`. Les types `*FormInput`
 * (`z.input`) couvrent ce cas : « ce que le formulaire envoie », par
 * opposition à « ce que l'API renvoie ».
 */
export type ProfileFormInput = z.input<typeof profileSchema>;
export type JobPreferencesFormInput = z.input<typeof jobPreferencesSchema>;
export type ExperienceFormInput = z.input<typeof experienceSchema>;
export type EducationFormInput = z.input<typeof educationSchema>;
export type SkillFormInput = z.input<typeof skillSchema>;
export type LanguageFormInput = z.input<typeof languageSchema>;
export type CertificationFormInput = z.input<typeof certificationSchema>;
export type ProjectFormInput = z.input<typeof projectSchema>;
export type ReorderFormInput = z.input<typeof reorderSchema>;
