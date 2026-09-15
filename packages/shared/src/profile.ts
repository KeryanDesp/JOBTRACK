import { z } from 'zod';

/**
 * Texte optionnel de formulaire. `''` signifie « effacer » et devient `null`
 * (colonne nullable) ; une clé absente reste `undefined` (inchangée).
 * `'   '` est aussi traité comme une effacement : le `.trim()` de la branche
 * chaîne produit `''`, que la transformation reconnaît ensuite.
 */
const optionalText = (max: number) =>
  z
    .union([z.literal(''), z.string().trim().max(max, `Maximum ${max} caractères.`)])
    .optional()
    .transform((value) => (value === '' ? null : value));

/**
 * URL optionnelle de formulaire : mêmes règles que optionalText (`''` → `null`,
 * absente → `undefined`), mais avec validation d'URL sur la branche non vide.
 */
const optionalUrl = z
  .union([z.literal(''), z.string().url('URL invalide.')])
  .optional()
  .transform((value) => (value === '' ? null : value));

/**
 * Nombre optionnel saisi dans un formulaire. Un champ vide arrive en `''` :
 * il doit devenir `undefined`, pas `0`. Pas de z.preprocess, pour que z.input
 * reste typé côté React Hook Form.
 */
const optionalNumber = (max: number) =>
  z
    .union([z.literal(''), z.coerce.number().int().min(0, 'Valeur invalide.').max(max, `Maximum ${max}.`)])
    .optional()
    .transform((value) => (value === '' ? undefined : value));

/**
 * Zod ajoute au résultat une clé dont la valeur transformée vaut `undefined`
 * dès lors que la clé existait dans l'entrée brute (ex. `{ yearsExperience: '' }`
 * devient en sortie `{ yearsExperience: undefined }`, la clé reste présente,
 * cf. `alwaysSet` dans ParseStatus.mergeObjectSync). On la retire pour qu'un
 * champ numérique vidé par l'utilisateur soit indiscernable d'une clé omise
 * (sémantique PATCH : omis = inchangé). Ne change rien pour les clés déjà
 * absentes ou dont la valeur est définie.
 */
function omitUndefinedValues<T extends Record<string, unknown>>(value: T): T {
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
    desiredRoles: z.array(z.string().trim().min(1)).max(10),
    desiredCategories: z.array(z.string().trim().min(1)).max(10),
    salaryMin: optionalNumber(1_000_000),
    salaryMax: optionalNumber(1_000_000),
    currency: z.string().length(3).default('EUR'),
    locations: z.array(z.string().trim().min(1)).max(10),
    searchRadiusKm: optionalNumber(500).transform((value) => value ?? 25),
    remoteModes: z.array(z.enum(['ONSITE', 'HYBRID', 'REMOTE'])),
    contractTypes: z.array(
      z.enum(['CDI', 'CDD', 'INTERNSHIP', 'APPRENTICESHIP', 'FREELANCE', 'PART_TIME']),
    ),
    availability: optionalText(80),
    experienceLevel: z.enum(['STUDENT', 'JUNIOR', 'MID', 'SENIOR', 'LEAD']).optional(),
  })
  .refine((value) => value.salaryMin === undefined || value.salaryMax === undefined || value.salaryMin <= value.salaryMax, {
    message: 'Le salaire minimum doit être inférieur au maximum.',
    path: ['salaryMax'],
  })
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

export const educationSchema = z.object({
  school: z.string().trim().min(1, 'Ce champ est obligatoire.').max(120),
  degree: z.string().trim().min(1, 'Ce champ est obligatoire.').max(120),
  field: optionalText(120),
  startDate: isoDate,
  endDate: isoDate.optional().nullable(),
  description: optionalText(2000),
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

export const certificationSchema = z.object({
  name: z.string().trim().min(1, 'Ce champ est obligatoire.').max(120),
  issuer: z.string().trim().min(1, 'Ce champ est obligatoire.').max(120),
  issuedAt: isoDate,
  expiresAt: isoDate.optional().nullable(),
  credentialUrl: optionalUrl,
});

export const projectSchema = z.object({
  name: z.string().trim().min(1, 'Ce champ est obligatoire.').max(120),
  description: optionalText(2000),
  url: optionalUrl,
  technologies: z.array(z.string().trim().min(1)).max(20).default([]),
});

export const reorderSchema = z.object({
  ids: z.array(z.string().cuid()).min(1),
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
