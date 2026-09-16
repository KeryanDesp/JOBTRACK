import { z } from 'zod';
import {
  certificationSchema,
  educationSchema,
  experienceSchema,
  languageSchema,
  omitUndefinedValues,
  optionalText,
  profileSchema,
  projectSchema,
  skillSchema,
} from './profile';

/**
 * URL de brouillon : contrairement a `optionalUrl` (profile.ts), une valeur qui
 * n'est pas une URL http(s) valide (ou depasse une longueur raisonnable) ne fait
 * pas echouer le parsing — elle devient `null`. Un brouillon issu d'un modele
 * reste exploitable meme si un champ secondaire est mal forme.
 */
const draftUrl = z.union([z.string(), z.null(), z.undefined()]).transform((value) => {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  if (trimmed === '' || trimmed.length > 2000) return null;
  try {
    const url = new URL(trimmed);
    return /^https?:$/.test(url.protocol) ? trimmed : null;
  } catch {
    return null;
  }
});

/**
 * Normalise une liste de chaines issue d'un modele : espaces superflus retires,
 * entrees vides ecartees (jamais d'echec pour ca), tronquee a `maxItems`
 * elements de `maxLength` caracteres chacun au plus.
 */
function sanitizeStringList(values: string[] | undefined, maxItems: number, maxLength: number): string[] {
  return (values ?? [])
    .map((value) => value.trim())
    .filter((value) => value.length > 0)
    .slice(0, maxItems)
    .map((value) => value.slice(0, maxLength));
}

// ---------------------------------------------------------------------------
// flexibleDate
// ---------------------------------------------------------------------------

// Meme controle calendaire que `isoDate` (profile.ts), applique a la valeur
// normalisee : verifie notamment les annees bissextiles (29 fevrier).
const calendarDate = z.string().date();

const MIN_YEAR = 1900;

// `noUncheckedIndexedAccess` type un groupe capture en `string | undefined` ; en
// pratique la valeur existe toujours ici (le groupe est obligatoire dans chaque
// regex appelante), le repli sur `''` ne sert qu'a satisfaire le typage.
function pad2(value: string | undefined): string {
  return (value ?? '').padStart(2, '0');
}

function normalizeFlexibleDate(raw: string): string | null {
  const value = raw.trim();
  const yearOnly = /^(\d{4})$/.exec(value);
  if (yearOnly) return `${yearOnly[1]}-01-01`;
  const yearMonth = /^(\d{4})-(\d{1,2})$/.exec(value);
  if (yearMonth) return `${yearMonth[1]}-${pad2(yearMonth[2])}-01`;
  const fullIso = /^(\d{4})-(\d{1,2})-(\d{1,2})$/.exec(value);
  if (fullIso) return `${fullIso[1]}-${pad2(fullIso[2])}-${pad2(fullIso[3])}`;
  const monthYear = /^(\d{1,2})\/(\d{4})$/.exec(value);
  if (monthYear) return `${monthYear[2]}-${pad2(monthYear[1])}-01`;
  const dayMonthYear = /^(\d{1,2})\/(\d{1,2})\/(\d{4})$/.exec(value);
  if (dayMonthYear) return `${dayMonthYear[3]}-${pad2(dayMonthYear[2])}-${pad2(dayMonthYear[1])}`;
  return null;
}

// Ecarte les annees non plausibles pour un CV (saisie a un chiffre pres, coquille
// d'annee a 4 chiffres qui reste dans le format mais pas dans le raisonnable).
function isPlausibleYear(normalized: string): boolean {
  const year = Number(normalized.slice(0, 4));
  return year >= MIN_YEAR && year <= new Date().getFullYear() + 1;
}

/**
 * Date tolerante telle qu'elle peut apparaitre dans un CV : annee seule,
 * annee-mois, date complete (AAAA-MM-JJ), MM/AAAA ou JJ/MM/AAAA (mois/jour a un
 * ou deux chiffres, zero-padding automatique), espaces superflus toleres.
 * Normalisee en AAAA-MM-JJ (mois/jour manquants -> `01`) ; `''` / `null` /
 * `undefined` -> `null`. Une valeur non reconnue, une date calendaire invalide
 * (ex. 31 avril, 29 fevrier hors annee bissextile) ou une annee peu plausible
 * (hors 1900 - annee courante + 1) leve l'erreur « Date non reconnue. ».
 */
export const flexibleDate = z.union([z.string(), z.null(), z.undefined()]).transform((value, ctx) => {
  if (value === undefined || value === null) return null;
  const trimmed = value.trim();
  if (trimmed === '') return null;
  const normalized = normalizeFlexibleDate(trimmed);
  if (normalized === null || !isPlausibleYear(normalized) || !calendarDate.safeParse(normalized).success) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'Date non reconnue.' });
    return z.NEVER;
  }
  return normalized;
});

// ---------------------------------------------------------------------------
// Correspondances (enonces libres du modele -> enumerations du profil)
// ---------------------------------------------------------------------------

type SkillCategory = z.infer<typeof skillSchema>['category'];
type SkillLevel = z.infer<typeof skillSchema>['level'];
type LanguageLevel = z.infer<typeof languageSchema>['level'];

// Minuscules, sans accents : 'Avancé', 'AVANCE' et 'avance' matchent pareil.
function normalizeToken(value: string): string {
  return value
    .trim()
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '');
}

const DIRECT_SKILL_CATEGORIES: Record<string, SkillCategory> = {
  technical: 'TECHNICAL',
  soft: 'SOFT',
  tool: 'TOOL',
  other: 'OTHER',
};

function mapSkillCategory(raw: string | null | undefined): SkillCategory {
  const value = normalizeToken(raw ?? '');
  const direct = DIRECT_SKILL_CATEGORIES[value];
  if (direct) return direct;
  if (/technique/.test(value)) return 'TECHNICAL';
  if (/outil|logiciel/.test(value)) return 'TOOL';
  if (/humaine|soft/.test(value)) return 'SOFT';
  return 'TECHNICAL';
}

const DIRECT_SKILL_LEVELS: Record<string, SkillLevel> = {
  beginner: 'BEGINNER',
  intermediate: 'INTERMEDIATE',
  advanced: 'ADVANCED',
  expert: 'EXPERT',
};

function mapSkillLevel(raw: string | null | undefined): SkillLevel {
  const value = normalizeToken(raw ?? '');
  const direct = DIRECT_SKILL_LEVELS[value];
  if (direct) return direct;
  if (/debutant/.test(value)) return 'BEGINNER';
  if (/intermediaire/.test(value)) return 'INTERMEDIATE';
  if (/avance|confirme/.test(value)) return 'ADVANCED';
  if (/expert/.test(value)) return 'EXPERT';
  return 'INTERMEDIATE';
}

const DIRECT_LANGUAGE_LEVELS: Record<string, LanguageLevel> = {
  a1: 'A1',
  a2: 'A2',
  b1: 'B1',
  b2: 'B2',
  c1: 'C1',
  c2: 'C2',
  native: 'NATIVE',
};

function mapLanguageLevel(raw: string | null | undefined): LanguageLevel {
  const value = normalizeToken(raw ?? '');
  const direct = DIRECT_LANGUAGE_LEVELS[value];
  if (direct) return direct;
  if (/natif|maternelle|native|bilingue/.test(value)) return 'NATIVE';
  if (/courant|fluent/.test(value)) return 'C1';
  if (/intermediaire/.test(value)) return 'B1';
  if (/scolaire|notions/.test(value)) return 'A2';
  return 'B2';
}

// ---------------------------------------------------------------------------
// Brouillons : entree tolerante (sortie du modele), sortie normalisee
// ---------------------------------------------------------------------------

export const experienceDraftSchema = z
  .object({
    company: z.string().trim().min(1, 'Ce champ est obligatoire.').max(120),
    role: z.string().trim().min(1, 'Ce champ est obligatoire.').max(120),
    location: optionalText(120),
    startDate: flexibleDate,
    endDate: flexibleDate,
    isCurrent: z.boolean().nullish(),
    description: optionalText(2000),
  })
  .transform((value, ctx) => {
    if (value.startDate === null) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'Date de début manquante.',
        path: ['startDate'],
      });
      return z.NEVER;
    }
    const isCurrent = value.isCurrent ?? value.endDate === null;
    const endDate = isCurrent ? null : value.endDate;
    if (!isCurrent && endDate !== null && value.startDate > endDate) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'La date de fin doit être postérieure à la date de début.',
        path: ['endDate'],
      });
      return z.NEVER;
    }
    return { ...value, startDate: value.startDate, isCurrent, endDate };
  });

export const educationDraftSchema = z
  .object({
    school: z.string().trim().min(1, 'Ce champ est obligatoire.').max(120),
    degree: z.string().trim().min(1, 'Ce champ est obligatoire.').max(120),
    field: optionalText(120),
    startDate: flexibleDate,
    endDate: flexibleDate,
    description: optionalText(2000),
  })
  .transform((value, ctx) => {
    if (value.startDate === null) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'Date de début manquante.',
        path: ['startDate'],
      });
      return z.NEVER;
    }
    if (value.endDate !== null && value.startDate > value.endDate) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'La date de fin doit être postérieure à la date de début.',
        path: ['endDate'],
      });
      return z.NEVER;
    }
    return { ...value, startDate: value.startDate };
  });

export const skillDraftSchema = z
  .object({
    name: z.string().trim().min(1, 'Ce champ est obligatoire.').max(60),
    category: z.string().nullish(),
    level: z.string().nullish(),
  })
  .transform((value) => ({
    name: value.name,
    category: mapSkillCategory(value.category),
    level: mapSkillLevel(value.level),
  }));

export const languageDraftSchema = z
  .object({
    name: z.string().trim().min(1, 'Ce champ est obligatoire.').max(60),
    level: z.string().nullish(),
  })
  .transform((value) => ({ name: value.name, level: mapLanguageLevel(value.level) }));

export const certificationDraftSchema = z
  .object({
    name: z.string().trim().min(1, 'Ce champ est obligatoire.').max(120),
    issuer: z.string().trim().min(1, 'Ce champ est obligatoire.').max(120),
    issuedAt: flexibleDate,
    expiresAt: flexibleDate,
    credentialUrl: draftUrl,
  })
  .transform((value, ctx) => {
    if (value.issuedAt === null) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "Date d'obtention manquante.",
        path: ['issuedAt'],
      });
      return z.NEVER;
    }
    if (value.expiresAt !== null && value.issuedAt > value.expiresAt) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "La date d'expiration doit être postérieure à la date d'obtention.",
        path: ['expiresAt'],
      });
      return z.NEVER;
    }
    return { ...value, issuedAt: value.issuedAt };
  });

export const projectDraftSchema = z.object({
  name: z.string().trim().min(1, 'Ce champ est obligatoire.').max(120),
  description: optionalText(2000),
  url: draftUrl,
  technologies: z
    .array(z.string())
    .optional()
    .transform((value) => sanitizeStringList(value, 20, 80)),
});

export type ExperienceDraft = z.infer<typeof experienceDraftSchema>;
export type EducationDraft = z.infer<typeof educationDraftSchema>;
export type SkillDraft = z.infer<typeof skillDraftSchema>;
export type LanguageDraft = z.infer<typeof languageDraftSchema>;
export type CertificationDraft = z.infer<typeof certificationDraftSchema>;
export type ProjectDraft = z.infer<typeof projectDraftSchema>;

// ---------------------------------------------------------------------------
// Extraction complete : chaque bloc a un defaut pour qu'une sortie partielle
// du modele (cle absente) reste valide.
// ---------------------------------------------------------------------------

export const cvExtractionSchema = z.object({
  identity: z
    .object({
      firstName: optionalText(80),
      lastName: optionalText(80),
      phone: optionalText(30),
      city: optionalText(80),
      country: optionalText(80),
      title: optionalText(120),
      summary: optionalText(2000),
    })
    .transform(omitUndefinedValues)
    .default({}),
  experiences: z.array(experienceDraftSchema).max(50, 'Maximum 50 expériences.').default([]),
  educations: z.array(educationDraftSchema).max(30, 'Maximum 30 formations.').default([]),
  skills: z.array(skillDraftSchema).max(100, 'Maximum 100 compétences.').default([]),
  languages: z.array(languageDraftSchema).max(20, 'Maximum 20 langues.').default([]),
  certifications: z.array(certificationDraftSchema).max(30, 'Maximum 30 certifications.').default([]),
  projects: z.array(projectDraftSchema).max(30, 'Maximum 30 projets.').default([]),
  preferences: z
    .object({
      desiredRoles: z
        .array(z.string())
        .optional()
        .transform((value) => sanitizeStringList(value, 10, 80)),
      locations: z
        .array(z.string())
        .optional()
        .transform((value) => sanitizeStringList(value, 10, 80)),
    })
    .default({}),
});

export type CvExtraction = z.output<typeof cvExtractionSchema>;

// ---------------------------------------------------------------------------
// Schema « fil » : miroir plat de l'extraction, sans union/transform/refine/
// default, pour la sortie structuree Anthropic (`zodOutputFormat`), qui ne
// sait pas convertir ces constructions en JSON Schema. Toutes les cles sont
// requises (nullable a la place d'optionnelles) ; les enumerations (niveaux,
// categories) restent de simples chaines nullable — le modele ecrit librement,
// `cvExtractionSchema.parse` se charge ensuite de les faire correspondre aux
// enumerations reelles.
// ---------------------------------------------------------------------------

const identityWireSchema = z
  .object({
    firstName: z.string().nullable(),
    lastName: z.string().nullable(),
    phone: z.string().nullable(),
    city: z.string().nullable(),
    country: z.string().nullable(),
    title: z.string().nullable(),
    summary: z.string().nullable(),
  })
  .strict();

const experienceWireSchema = z
  .object({
    company: z.string(),
    role: z.string(),
    location: z.string().nullable(),
    startDate: z.string().nullable(),
    endDate: z.string().nullable(),
    isCurrent: z.boolean().nullable(),
    description: z.string().nullable(),
  })
  .strict();

const educationWireSchema = z
  .object({
    school: z.string(),
    degree: z.string(),
    field: z.string().nullable(),
    startDate: z.string().nullable(),
    endDate: z.string().nullable(),
    description: z.string().nullable(),
  })
  .strict();

const skillWireSchema = z
  .object({
    name: z.string(),
    category: z.string().nullable(),
    level: z.string().nullable(),
  })
  .strict();

const languageWireSchema = z
  .object({
    name: z.string(),
    level: z.string().nullable(),
  })
  .strict();

const certificationWireSchema = z
  .object({
    name: z.string(),
    issuer: z.string(),
    issuedAt: z.string().nullable(),
    expiresAt: z.string().nullable(),
    credentialUrl: z.string().nullable(),
  })
  .strict();

const projectWireSchema = z
  .object({
    name: z.string(),
    description: z.string().nullable(),
    url: z.string().nullable(),
    technologies: z.array(z.string()),
  })
  .strict();

const preferencesWireSchema = z
  .object({
    desiredRoles: z.array(z.string()),
    locations: z.array(z.string()),
  })
  .strict();

export const cvExtractionWireSchema = z
  .object({
    identity: identityWireSchema,
    experiences: z.array(experienceWireSchema),
    educations: z.array(educationWireSchema),
    skills: z.array(skillWireSchema),
    languages: z.array(languageWireSchema),
    certifications: z.array(certificationWireSchema),
    projects: z.array(projectWireSchema),
    preferences: preferencesWireSchema,
  })
  .strict();

export type CvExtractionWire = z.infer<typeof cvExtractionWireSchema>;

// ---------------------------------------------------------------------------
// Application : contenu valide par l'utilisateur, ecrit en base via les
// schemas stricts du profil (chaque element porte `selected`).
// ---------------------------------------------------------------------------

const identityApplySchema = profileSchema
  .innerType()
  .pick({
    firstName: true,
    lastName: true,
    phone: true,
    city: true,
    country: true,
    title: true,
    summary: true,
  })
  .partial()
  .transform(omitUndefinedValues);

export const cvApplySchema = z.object({
  identity: identityApplySchema.default({}),
  experiences: z.array(z.object({ selected: z.boolean(), item: experienceSchema })).default([]),
  educations: z.array(z.object({ selected: z.boolean(), item: educationSchema })).default([]),
  skills: z.array(z.object({ selected: z.boolean(), item: skillSchema })).default([]),
  languages: z.array(z.object({ selected: z.boolean(), item: languageSchema })).default([]),
  certifications: z.array(z.object({ selected: z.boolean(), item: certificationSchema })).default([]),
  projects: z.array(z.object({ selected: z.boolean(), item: projectSchema })).default([]),
  preferences: z
    .object({
      // Cle absente = inchangee (semantique PATCH) ; presente = remplacee par
      // la liste assainie (chaines vides ecartees plutot qu'un echec).
      desiredRoles: z
        .array(z.string())
        .optional()
        .transform((value) => (value === undefined ? undefined : sanitizeStringList(value, 10, 80))),
      locations: z
        .array(z.string())
        .optional()
        .transform((value) => (value === undefined ? undefined : sanitizeStringList(value, 10, 80))),
    })
    .default({}),
});

export type CvApplyInput = z.output<typeof cvApplySchema>;
export type CvApplyFormInput = z.input<typeof cvApplySchema>;

// ---------------------------------------------------------------------------
// Types transverses (statut, DTO, capacites, resultat d'application)
// ---------------------------------------------------------------------------

export type CvImportStatus = 'PENDING' | 'EXTRACTED' | 'FAILED' | 'APPLIED';

export interface CvImportDto {
  id: string;
  fileName: string;
  status: CvImportStatus;
  extracted: CvExtraction | null;
  error: string | null;
  createdAt: string;
}

export interface CvCapabilities {
  ai: boolean;
  maxSizeBytes: number;
  acceptedTypes: string[];
}

export interface CvApplyResult {
  created: Record<
    'experiences' | 'educations' | 'skills' | 'languages' | 'certifications' | 'projects',
    number
  >;
}
