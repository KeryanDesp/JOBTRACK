import { z } from 'zod';
import {
  certificationSchema,
  educationSchema,
  experienceSchema,
  languageSchema,
  profileSchema,
  projectSchema,
  skillSchema,
} from './profile';

/**
 * Memes helpers que profile.ts (`optionalText`, `omitUndefinedValues`) : ils n'y
 * sont pas exportes (contrat deja livre en tranche 1), on reprend simplement l'idee
 * ici plutot que d'exposer les internes d'un autre module.
 */
const optionalText = (max: number) =>
  z
    .union([z.literal(''), z.string().trim().max(max, `Maximum ${max} caracteres.`)])
    .optional()
    .transform((value) => (value === '' ? null : value));

function omitUndefinedValues<T extends Record<string, unknown>>(value: T): T {
  const result = { ...value };
  for (const key of Object.keys(result) as (keyof T)[]) {
    if (result[key] === undefined) delete result[key];
  }
  return result;
}

/**
 * URL de brouillon : contrairement a `optionalUrl` (profile.ts), une valeur qui
 * n'est pas une URL http(s) valide ne fait pas echouer le parsing — elle devient
 * `null`. Un brouillon issu d'un modele reste exploitable meme si un champ
 * secondaire est mal forme.
 */
const draftUrl = z.union([z.string(), z.null(), z.undefined()]).transform((value) => {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  if (trimmed === '') return null;
  try {
    const url = new URL(trimmed);
    return /^https?:$/.test(url.protocol) ? trimmed : null;
  } catch {
    return null;
  }
});

// ---------------------------------------------------------------------------
// flexibleDate
// ---------------------------------------------------------------------------

// Meme controle calendaire que `isoDate` (profile.ts), applique a la valeur
// normalisee : verifie notamment les annees bissextiles (29 fevrier).
const calendarDate = z.string().date();

function normalizeFlexibleDate(raw: string): string | null {
  const value = raw.trim();
  const yearOnly = /^(\d{4})$/.exec(value);
  if (yearOnly) return `${yearOnly[1]}-01-01`;
  const yearMonth = /^(\d{4})-(\d{2})$/.exec(value);
  if (yearMonth) return `${yearMonth[1]}-${yearMonth[2]}-01`;
  const fullIso = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (fullIso) return `${fullIso[1]}-${fullIso[2]}-${fullIso[3]}`;
  const monthYear = /^(\d{2})\/(\d{4})$/.exec(value);
  if (monthYear) return `${monthYear[2]}-${monthYear[1]}-01`;
  const dayMonthYear = /^(\d{2})\/(\d{2})\/(\d{4})$/.exec(value);
  if (dayMonthYear) return `${dayMonthYear[3]}-${dayMonthYear[2]}-${dayMonthYear[1]}`;
  return null;
}

/**
 * Date tolerante telle qu'elle peut apparaitre dans un CV : annee seule,
 * annee-mois, date complete (AAAA-MM-JJ), MM/AAAA ou JJ/MM/AAAA, espaces
 * superflus toleres. Normalisee en AAAA-MM-JJ (mois/jour manquants -> `01`) ;
 * `''` / `null` / `undefined` -> `null`. Une valeur non reconnue ou une date
 * calendaire invalide (ex. 31 avril, 29 fevrier hors annee bissextile) leve
 * l'erreur « Date non reconnue. ».
 */
export const flexibleDate = z.union([z.string(), z.null(), z.undefined()]).transform((value, ctx) => {
  if (value === undefined || value === null) return null;
  const trimmed = value.trim();
  if (trimmed === '') return null;
  const normalized = normalizeFlexibleDate(trimmed);
  if (normalized === null || !calendarDate.safeParse(normalized).success) {
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

function mapSkillCategory(raw: string | undefined): SkillCategory {
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

function mapSkillLevel(raw: string | undefined): SkillLevel {
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

function mapLanguageLevel(raw: string | undefined): LanguageLevel {
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
    isCurrent: z.boolean().optional(),
    description: optionalText(2000),
  })
  .transform((value, ctx) => {
    if (value.startDate === null) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'Date de debut manquante.',
        path: ['startDate'],
      });
    }
    const isCurrent = value.isCurrent ?? value.endDate === null;
    const endDate = isCurrent ? null : value.endDate;
    if (!isCurrent && value.startDate !== null && endDate !== null && value.startDate > endDate) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'La date de fin doit etre posterieure a la date de debut.',
        path: ['endDate'],
      });
    }
    return { ...value, isCurrent, endDate };
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
        message: 'Date de debut manquante.',
        path: ['startDate'],
      });
    }
    return value;
  });

export const skillDraftSchema = z
  .object({
    name: z.string().trim().min(1, 'Ce champ est obligatoire.').max(60),
    category: z.string().optional(),
    level: z.string().optional(),
  })
  .transform((value) => ({
    name: value.name,
    category: mapSkillCategory(value.category),
    level: mapSkillLevel(value.level),
  }));

export const languageDraftSchema = z
  .object({
    name: z.string().trim().min(1, 'Ce champ est obligatoire.').max(60),
    level: z.string().optional(),
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
        message: 'Date d obtention manquante.',
        path: ['issuedAt'],
      });
    }
    return value;
  });

export const projectDraftSchema = z.object({
  name: z.string().trim().min(1, 'Ce champ est obligatoire.').max(120),
  description: optionalText(2000),
  url: draftUrl,
  technologies: z
    .array(z.string())
    .optional()
    .transform((value) =>
      (value ?? [])
        .map((technology) => technology.trim())
        .filter((technology) => technology.length > 0)
        .slice(0, 20)
        .map((technology) => technology.slice(0, 80)),
    ),
});

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
  experiences: z.array(experienceDraftSchema).max(50, 'Maximum 50 experiences.').default([]),
  educations: z.array(educationDraftSchema).max(30, 'Maximum 30 formations.').default([]),
  skills: z.array(skillDraftSchema).max(100, 'Maximum 100 competences.').default([]),
  languages: z.array(languageDraftSchema).max(20, 'Maximum 20 langues.').default([]),
  certifications: z.array(certificationDraftSchema).max(30, 'Maximum 30 certifications.').default([]),
  projects: z.array(projectDraftSchema).max(30, 'Maximum 30 projets.').default([]),
  preferences: z
    .object({
      desiredRoles: z.array(z.string().trim().min(1).max(80)).max(10, 'Maximum 10 postes.').default([]),
      locations: z.array(z.string().trim().min(1).max(80)).max(10, 'Maximum 10 lieux.').default([]),
    })
    .default({}),
});

export type CvExtraction = z.output<typeof cvExtractionSchema>;

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
  identity: identityApplySchema,
  experiences: z.array(z.object({ selected: z.boolean(), item: experienceSchema })),
  educations: z.array(z.object({ selected: z.boolean(), item: educationSchema })),
  skills: z.array(z.object({ selected: z.boolean(), item: skillSchema })),
  languages: z.array(z.object({ selected: z.boolean(), item: languageSchema })),
  certifications: z.array(z.object({ selected: z.boolean(), item: certificationSchema })),
  projects: z.array(z.object({ selected: z.boolean(), item: projectSchema })),
  preferences: z.object({
    desiredRoles: z.array(z.string().trim().min(1).max(80)).max(10, 'Maximum 10 postes.').optional(),
    locations: z.array(z.string().trim().min(1).max(80)).max(10, 'Maximum 10 lieux.').optional(),
  }),
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
