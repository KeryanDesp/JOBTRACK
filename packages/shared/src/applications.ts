import { z } from 'zod';
import type { MatchScoreSummaryDto } from './matching';
import type { CoverLetterTone } from './resume';

// ---------------------------------------------------------------------------
// Énumérations
// ---------------------------------------------------------------------------

// Ordre des colonnes du Kanban (spec §2/§4) : cette liste est l'unique source
// de l'ordre, aussi bien pour la validation que pour tout composant qui doit
// itérer les statuts dans l'ordre d'affichage.
export const APPLICATION_STATUSES = ['TO_APPLY', 'APPLIED', 'INTERVIEW', 'OFFER', 'REJECTED'] as const;
export const applicationStatusSchema = z.enum(APPLICATION_STATUSES);
export type ApplicationStatus = z.infer<typeof applicationStatusSchema>;

export const APPLICATION_STATUS_LABELS: Record<ApplicationStatus, string> = {
  TO_APPLY: 'À postuler',
  APPLIED: 'Candidature envoyée',
  INTERVIEW: 'Entretien',
  OFFER: 'Offre',
  REJECTED: 'Refusée',
};

export const APPLICATION_SOURCES = ['FRANCE_TRAVAIL', 'LINKEDIN', 'INDEED', 'CAREER_SITE', 'NETWORK', 'OTHER'] as const;
export const applicationSourceSchema = z.enum(APPLICATION_SOURCES);
export type ApplicationSource = z.infer<typeof applicationSourceSchema>;

export const APPLICATION_SOURCE_LABELS: Record<ApplicationSource, string> = {
  FRANCE_TRAVAIL: 'France Travail',
  LINKEDIN: 'LinkedIn',
  INDEED: 'Indeed',
  CAREER_SITE: 'Site carrière',
  NETWORK: 'Réseau',
  OTHER: 'Autre',
};

// Onglets de la vue table (spec §2) : `all` n'a pas de statut correspondant
// (aucun filtre), les cinq autres correspondent chacun à un `ApplicationStatus`.
export const APPLICATION_TAB_VALUES = ['all', 'to_apply', 'applied', 'interview', 'offer', 'rejected'] as const;
export const applicationTabSchema = z.enum(APPLICATION_TAB_VALUES);
export type ApplicationTab = z.infer<typeof applicationTabSchema>;

const TAB_TO_STATUS: Record<ApplicationTab, ApplicationStatus | null> = {
  all: null,
  to_apply: 'TO_APPLY',
  applied: 'APPLIED',
  interview: 'INTERVIEW',
  offer: 'OFFER',
  rejected: 'REJECTED',
};

/** Convertit un onglet de la vue table en statut à filtrer, `null` pour « Toutes ». */
export function applicationTabToStatus(tab: ApplicationTab): ApplicationStatus | null {
  return TAB_TO_STATUS[tab];
}

export const APPLICATION_EVENT_TYPES = ['CREATED', 'STATUS_CHANGED', 'NOTE_UPDATED', 'RESUME_CHANGED'] as const;
export const applicationEventTypeSchema = z.enum(APPLICATION_EVENT_TYPES);
export type ApplicationEventType = z.infer<typeof applicationEventTypeSchema>;

export const APPLICATION_EVENT_LABELS: Record<ApplicationEventType, string> = {
  CREATED: 'Candidature créée',
  STATUS_CHANGED: 'Statut modifié',
  NOTE_UPDATED: 'Notes mises à jour',
  RESUME_CHANGED: 'CV modifié',
};

export const APPLICATION_SORT_VALUES = ['updated_desc', 'applied_desc', 'company_asc'] as const;
export const applicationSortSchema = z.enum(APPLICATION_SORT_VALUES);
export type ApplicationSort = z.infer<typeof applicationSortSchema>;

// ---------------------------------------------------------------------------
// Helpers de texte
// ---------------------------------------------------------------------------

// Contrôles C0/C1 (dont tabulations et retours à la ligne — un champ de
// candidature reste toujours sur une seule ligne logique) et marques de
// direction bidirectionnelle (LRM/RLM, LRE/RLE/PDF/LRO/RLO, LRI/RLI/FSI/PDI) :
// invisibles ou perturbatrices une fois affichées (spec §5 — « caractères de
// contrôle et séquences bidi retirés »), jamais un contenu légitime d'un
// titre de poste, d'une entreprise ou d'une note.
//
// Bornes en points de code numériques (hexadécimal) plutôt qu'un motif
// d'échappement Unicode dans une classe de caractères : un tel échappement,
// une fois écrit sur disque, se retrouve parfois réinterprété en un caractère
// brut (y compris l'octet nul lui-même) par la chaîne d'outils — justement
// les caractères que ce fichier a pour rôle de retirer. Les tableaux
// ci-dessous ne contiennent que des chiffres ASCII, jamais de séquence
// d'échappement.
const CONTROL_OR_BIDI_RANGES: ReadonlyArray<readonly [number, number]> = [
  [0x00, 0x1f], // C0 (dont tabulation, retour chariot, saut de ligne)
  [0x7f, 0x9f], // DEL + C1
  [0x200e, 0x200f], // LRM, RLM
  [0x202a, 0x202e], // LRE, RLE, PDF, LRO, RLO
  [0x2066, 0x2069], // LRI, RLI, FSI, PDI
];

function isControlOrBidiCodePoint(codePoint: number): boolean {
  return CONTROL_OR_BIDI_RANGES.some(([start, end]) => codePoint >= start && codePoint <= end);
}

/** Retire les caractères de contrôle et les séquences bidi d'une chaîne. */
export function stripControlChars(value: string): string {
  return Array.from(value)
    .filter((char) => !isControlOrBidiCodePoint(char.codePointAt(0) ?? 0))
    .join('');
}

/**
 * Champ texte de candidature (spec §4/§5, tâche 2) : chaîne nettoyée
 * (caractères de contrôle/bidi retirés) puis bornée à `max` caractères.
 * `min` (défaut 0, non requis) ajoute une borne basse — utilisé pour les
 * champs obligatoires (`jobTitle`) avec le message « Ce champ est
 * obligatoire. ».
 */
export function applicationTextField(max: number, min = 0) {
  const bounded =
    min > 0
      ? z.string().min(min, 'Ce champ est obligatoire.').max(max, `Maximum ${max} caractères.`)
      : z.string().max(max, `Maximum ${max} caractères.`);
  return z.string().transform((value) => stripControlChars(value).trim()).pipe(bounded);
}

/**
 * Lien externe (spec §5) : uniquement `http(s)` — un `javascript:`/`data:`
 * bien formé pour `new URL()` mais dangereux une fois affiché en lien
 * cliquable (`rel="noopener noreferrer"` côté web) ne doit jamais être
 * accepté.
 */
export const httpUrlSchema = z
  .string()
  .trim()
  .max(500, 'Maximum 500 caractères.')
  .url('Lien invalide (http ou https).')
  .refine((value) => /^https?:$/.test(new URL(value).protocol), 'Lien invalide (http ou https).');

// Date calendaire AAAA-MM-JJ (colonne `@db.Date`, jamais d'heure) : `z.string().date()`
// (utilisé par `profile.ts`/`resume.ts`) ne valide que le format, pas le calendrier
// réel (`2026-02-30` passerait) — un `refine` supplémentaire reconstruit la date en
// UTC et vérifie qu'elle « rebondit » sur les mêmes année/mois/jour.
export const isoDateSchema = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, 'Date invalide.')
  .refine((value) => {
    const [year, month, day] = value.split('-').map(Number) as [number, number, number];
    const date = new Date(Date.UTC(year, month - 1, day));
    return date.getUTCFullYear() === year && date.getUTCMonth() === month - 1 && date.getUTCDate() === day;
  }, 'Date invalide.');

// Identifiant référencé (jobId, resumeId, coverLetterId) : mêmes bornes que
// les identifiants `cuid` du reste du contrat (`resume.ts`).
const requiredIdSchema = (message = 'Ce champ est obligatoire.') => z.string().trim().min(1, message).max(64);
const nullableIdSchema = requiredIdSchema().nullable().optional();

// ---------------------------------------------------------------------------
// Exclusivité du CV utilisé (spec §4/§5) : `resumeId` (CV adapté) et
// `usedBaseResume: true` (CV principal) ne peuvent jamais être renseignés
// ensemble.
// ---------------------------------------------------------------------------

function refineCvExclusivity(
  data: { resumeId?: string | null; usedBaseResume?: boolean },
  ctx: z.RefinementCtx,
): void {
  if (data.usedBaseResume === true && data.resumeId != null) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message: 'Choisissez soit le CV principal, soit un CV adapté.',
      path: ['resumeId'],
    });
  }
}

// ---------------------------------------------------------------------------
// Création (spec §4/§6) : union « depuis une offre » / « manuelle »
// ---------------------------------------------------------------------------

export const createFromJobSchema = z
  .object({
    jobId: requiredIdSchema(),
    status: applicationStatusSchema.default('TO_APPLY'),
    resumeId: nullableIdSchema,
    coverLetterId: nullableIdSchema,
    usedBaseResume: z.boolean().default(false),
    appliedAt: isoDateSchema.nullable().optional(),
  })
  .strict()
  .superRefine(refineCvExclusivity);

export type CreateFromJobInput = z.output<typeof createFromJobSchema>;
export type CreateFromJobFormInput = z.input<typeof createFromJobSchema>;

export const createManualSchema = z
  .object({
    jobTitle: applicationTextField(160, 1),
    company: applicationTextField(120).optional(),
    source: applicationSourceSchema.default('OTHER'),
    sourceUrl: httpUrlSchema.nullable().optional(),
    locationLabel: applicationTextField(120).optional(),
    salaryLabel: applicationTextField(80).optional(),
    contractLabel: applicationTextField(80).optional(),
    status: applicationStatusSchema.default('TO_APPLY'),
    appliedAt: isoDateSchema.nullable().optional(),
    resumeId: nullableIdSchema,
    usedBaseResume: z.boolean().default(false),
    notes: applicationTextField(4000).optional(),
  })
  .strict()
  .superRefine(refineCvExclusivity);

export type CreateManualInput = z.output<typeof createManualSchema>;
export type CreateManualFormInput = z.input<typeof createManualSchema>;

/**
 * Union discriminée par la présence de `jobId` (spec §4) : `z.union` plutôt
 * que `z.discriminatedUnion` (aucune des deux branches ne porte de clé
 * littérale commune qui les distinguerait — `jobId` est requis d'un côté et
 * absent de l'autre, pas une valeur discriminante), chaque branche portant
 * déjà sa propre exclusivité CV (`refineCvExclusivity`).
 */
export const createApplicationSchema = z.union([createFromJobSchema, createManualSchema]);

export type CreateApplicationInput = z.output<typeof createApplicationSchema>;
export type CreateApplicationFormInput = z.input<typeof createApplicationSchema>;

/** Garde de type : distingue les deux branches de `createApplicationSchema` par la présence de `jobId`. */
export function isCreateFromJob(input: CreateApplicationInput): input is CreateFromJobInput {
  return 'jobId' in input;
}

// ---------------------------------------------------------------------------
// Mise à jour (spec §4/§6) : tous les champs éditables, optionnels
// ---------------------------------------------------------------------------

export const updateApplicationSchema = z
  .object({
    status: applicationStatusSchema.optional(),
    appliedAt: isoDateSchema.nullable().optional(),
    resumeId: nullableIdSchema,
    coverLetterId: nullableIdSchema,
    usedBaseResume: z.boolean().optional(),
    notes: applicationTextField(4000).nullable().optional(),
    jobTitle: applicationTextField(160, 1).optional(),
    company: applicationTextField(120).nullable().optional(),
    source: applicationSourceSchema.optional(),
    sourceUrl: httpUrlSchema.nullable().optional(),
    locationLabel: applicationTextField(120).nullable().optional(),
    salaryLabel: applicationTextField(80).nullable().optional(),
    contractLabel: applicationTextField(80).nullable().optional(),
  })
  .strict()
  .superRefine((data, ctx) => {
    if (Object.keys(data).length === 0) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'Aucune modification.', path: [] });
      return;
    }
    refineCvExclusivity(data, ctx);
  });

export type UpdateApplicationInput = z.output<typeof updateApplicationSchema>;
export type UpdateApplicationFormInput = z.input<typeof updateApplicationSchema>;

// ---------------------------------------------------------------------------
// Déplacement Kanban (spec §2/§6)
// ---------------------------------------------------------------------------

export const moveApplicationSchema = z
  .object({
    status: applicationStatusSchema,
    position: z.number().int().min(0).max(500),
  })
  .strict();

export type MoveApplicationInput = z.output<typeof moveApplicationSchema>;

// ---------------------------------------------------------------------------
// Liste (spec §6) — query string : `z.coerce` comme `jobSearchQuerySchema`
// (jobs.ts) pour les champs numériques, une chaîne vide traitée comme absente
// pour `q`.
// ---------------------------------------------------------------------------

export const applicationListQuerySchema = z.object({
  tab: applicationTabSchema.default('all'),
  q: z
    .string()
    .trim()
    .max(120, 'Maximum 120 caractères.')
    .optional()
    .transform((value) => (value === undefined || value === '' ? undefined : value)),
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(50).default(20),
  sort: applicationSortSchema.default('updated_desc'),
});
// Les clés inconnues sont retirées silencieusement (comportement par défaut
// de `z.object` sans `.strict()`/`.passthrough()`), comme `jobSearchQuerySchema`.

export type ApplicationListQuery = z.output<typeof applicationListQuerySchema>;
export type ApplicationListQueryInput = z.input<typeof applicationListQuerySchema>;

// ---------------------------------------------------------------------------
// DTO (dates en chaînes ISO)
// ---------------------------------------------------------------------------

export interface ApplicationJobRefDto {
  id: string;
  title: string;
  company: string | null;
  match: MatchScoreSummaryDto | null;
}

export interface ApplicationResumeRefDto {
  id: string;
  title: string;
  currentVersion: number;
}

export interface ApplicationLetterRefDto {
  id: string;
  tone: CoverLetterTone;
}

export interface ApplicationDto {
  id: string;
  jobId: string | null;
  status: ApplicationStatus;
  position: number;
  jobTitle: string;
  company: string | null;
  locationLabel: string | null;
  salaryLabel: string | null;
  contractLabel: string | null;
  source: ApplicationSource;
  sourceUrl: string | null;
  /** AAAA-MM-JJ, `null` tant que le statut est resté `TO_APPLY`. */
  appliedAt: string | null;
  usedBaseResume: boolean;
  resumeId: string | null;
  coverLetterId: string | null;
  notes: string | null;
  createdAt: string;
  updatedAt: string;
  job: ApplicationJobRefDto | null;
  resume: ApplicationResumeRefDto | null;
  coverLetter: ApplicationLetterRefDto | null;
}

export interface ApplicationEventDto {
  id: string;
  type: ApplicationEventType;
  fromStatus: ApplicationStatus | null;
  toStatus: ApplicationStatus | null;
  note: string | null;
  createdAt: string;
}

export interface ApplicationDetailDto extends ApplicationDto {
  /** Ordre antéchronologique (le plus récent en premier). */
  events: ApplicationEventDto[];
}

export interface ApplicationListResponseDto {
  items: ApplicationDto[];
  page: number;
  limit: number;
  total: number;
}

export interface ApplicationBoardDto {
  columns: Record<ApplicationStatus, ApplicationDto[]>;
}

export interface ApplicationStatsDto {
  total: number;
  byStatus: Record<ApplicationStatus, number>;
  appliedThisWeek: number;
  /** (entretiens + offres) / (envoyées + entretiens + offres + refusées), `null` sans dénominateur. */
  interviewRate: number | null;
}

/** Référence légère portée par `JobDetailDto.application` (jobs.ts). */
export interface JobApplicationRefDto {
  id: string;
  status: ApplicationStatus;
}
