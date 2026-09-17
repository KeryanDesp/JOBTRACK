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

export const APPLICATION_TAB_LABELS: Record<ApplicationTab, string> = {
  all: 'Toutes',
  to_apply: 'À postuler',
  applied: 'Envoyées',
  interview: 'Entretien',
  offer: 'Offre',
  rejected: 'Refusées',
};

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

export const APPLICATION_SORT_LABELS: Record<ApplicationSort, string> = {
  updated_desc: 'Dernière mise à jour',
  applied_desc: 'Date de candidature',
  company_asc: 'Entreprise A→Z',
};

// ---------------------------------------------------------------------------
// Helpers de texte
// ---------------------------------------------------------------------------

// Contrôles C0/C1, marques et contrôles bidirectionnels invisibles (LRM/RLM,
// espace/joints de largeur nulle, embarquements/dépassements LRE/RLE/PDF/
// LRO/RLO, isolats LRI/RLI/FSI/PDI, séparateurs de ligne/paragraphe U+2028/29,
// BOM/espace insécable de largeur nulle U+FEFF) : invisibles ou perturbateurs
// une fois affichés (spec §5 — « caractères de contrôle et séquences bidi
// retirés »), jamais un contenu légitime d'un titre de poste, d'une
// entreprise ou d'une note. La tabulation (0x09) et le saut de ligne (0x0A),
// tous deux dans la plage C0, sont traités séparément par `sanitizeText`
// (jamais simplement retirés par cette fonction) : voir plus bas.
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
  [0x200b, 0x200f], // espace/joints de largeur nulle, LRM, RLM
  [0x2028, 0x202e], // séparateurs de ligne/paragraphe, LRE, RLE, PDF, LRO, RLO
  [0x2060, 0x2064], // joint de mots, opérateurs invisibles
  [0x2066, 0x2069], // LRI, RLI, FSI, PDI
  [0xfeff, 0xfeff], // BOM / espace insécable de largeur nulle
];

function isControlOrBidiCodePoint(codePoint: number): boolean {
  return CONTROL_OR_BIDI_RANGES.some(([start, end]) => codePoint >= start && codePoint <= end);
}

/** Un caractère de contrôle/bidi (`CONTROL_OR_BIDI_RANGES`) est présent dans la chaîne brute —
 * utilisé par `httpUrlSchema` (spec §5), où aucune transformation ne doit silencieusement
 * modifier un lien avant affichage : un tel lien est rejeté plutôt que nettoyé. */
function containsControlOrBidiChar(value: string): boolean {
  return Array.from(value).some((char) => isControlOrBidiCodePoint(char.codePointAt(0) ?? 0));
}

const TAB_CODE_POINT = 0x09;
const NEWLINE_CODE_POINT = 0x0a;

export interface SanitizeTextOptions {
  /** Conserve les sauts de ligne (`\n`) au lieu de les retirer. Faux par défaut — seul un champ
   * multi-paragraphes (`notes`) en a besoin ; tous les autres champs restent sur une seule
   * ligne logique affichée. */
  multiline?: boolean;
}

/**
 * Nettoie un texte de candidature (spec §5, tâche 2) : `\r\n`/`\r` sont d'abord ramenés à `\n`,
 * puis chaque caractère est examiné — une tabulation devient un espace (jamais retirée : elle
 * recollerait deux mots), un saut de ligne est conservé seulement en mode `multiline` (sinon
 * retiré, comme tout autre caractère de contrôle), et tout caractère de contrôle/bidi restant
 * (`CONTROL_OR_BIDI_RANGES`) est retiré. Le résultat est enfin coupé (`trim`) des espaces en
 * bordure.
 */
export function sanitizeText(value: string, options: SanitizeTextOptions = {}): string {
  const { multiline = false } = options;
  const normalized = value.replace(/\r\n|\r/g, '\n');
  let result = '';
  for (const char of normalized) {
    const codePoint = char.codePointAt(0) ?? 0;
    if (codePoint === TAB_CODE_POINT) {
      result += ' ';
      continue;
    }
    if (codePoint === NEWLINE_CODE_POINT) {
      if (multiline) result += '\n';
      continue;
    }
    if (isControlOrBidiCodePoint(codePoint)) continue;
    result += char;
  }
  return result.trim();
}

export interface ApplicationTextFieldOptions {
  /** Borne basse (défaut 0, non requis). Utilisé pour les champs obligatoires (`jobTitle`) avec
   * le message « Ce champ est obligatoire. ». */
  min?: number;
  /** Conserve les sauts de ligne — seules les `notes` (champ multi-paragraphes) l'activent. */
  multiline?: boolean;
}

/**
 * Champ texte de candidature (spec §4/§5, tâche 2) : chaîne nettoyée (`sanitizeText`) puis
 * bornée à `max` caractères. La base accepte aussi une clé complètement absente (`undefined`,
 * ramené à `''` avant nettoyage) : sans ça, un champ requis (`jobTitle`, `min > 0`) omis
 * échouerait sur le message générique `Required` de `z.string()` plutôt que sur le message
 * dédié « Ce champ est obligatoire. » de `.min()` — la seule différence perceptible entre
 * « champ absent » et « champ vide » ne doit jamais dépendre de la présence de la clé.
 */
export function applicationTextField(max: number, options: ApplicationTextFieldOptions = {}) {
  const { min = 0, multiline = false } = options;
  const bounded =
    min > 0
      ? z.string().min(min, 'Ce champ est obligatoire.').max(max, `Maximum ${max} caractères.`)
      : z.string().max(max, `Maximum ${max} caractères.`);
  return z
    .string()
    .optional()
    .transform((value) => sanitizeText(value ?? '', { multiline }))
    .pipe(bounded);
}

/**
 * Champ texte optionnel et nullable de candidature (spec §5, tâche 5) : mêmes règles que
 * `optionalText` (profile.ts) — `''` ou `null` en entrée deviennent `null` (colonne nullable),
 * une clé absente reste `undefined` (inchangée, sémantique PATCH) — mais nettoyé avec
 * `sanitizeText` (caractères de contrôle/bidi retirés) plutôt qu'un simple `.trim()`.
 * `'   '` est aussi traité comme un effacement : `sanitizeText` le réduit à `''`, que la
 * dernière transformation reconnaît ensuite.
 */
export function nullableTextField(max: number, options: SanitizeTextOptions = {}) {
  const { multiline = false } = options;
  return z
    .union([z.literal(''), z.null(), z.string()])
    .optional()
    .transform((value) => (value === undefined || value === null ? value : sanitizeText(value, { multiline })))
    .pipe(z.string().max(max, `Maximum ${max} caractères.`).nullable().optional())
    .transform((value) => (value === '' ? null : value));
}

/**
 * Lien externe (spec §5) : uniquement `http(s)`, sans identifiants embarqués
 * (`user:pass@host`, jamais légitimes pour un lien d'offre) et sans caractère de
 * contrôle/bidi. Un seul `superRefine` plutôt qu'un `.url()` suivi d'un `.refine()` : les
 * « checks » Zod (dont `.url()`) s'accumulent sur le même schéma sans jamais l'interrompre
 * (statut « dirty », pas « aborted ») — un `.refine()`/`.superRefine()` chaîné après s'exécute
 * donc même quand `.url()` a déjà échoué, et `new URL(value)` y lève alors une `TypeError` non
 * interceptée (500 via `ZodValidationPipe.safeParse`, jamais un 400). Regrouper toute la
 * validation dans un seul `superRefine` avec `try/catch` évite ce piège par construction.
 */
export const httpUrlSchema = z
  .string()
  .trim()
  .max(500, 'Maximum 500 caractères.')
  .superRefine((value, ctx) => {
    const reject = () => ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'Lien invalide (http ou https).' });

    if (containsControlOrBidiChar(value)) {
      reject();
      return;
    }

    let url: URL;
    try {
      url = new URL(value);
    } catch {
      reject();
      return;
    }

    if (url.protocol !== 'http:' && url.protocol !== 'https:') {
      reject();
      return;
    }

    if (url.username !== '' || url.password !== '') {
      reject();
    }
  });

/** `sourceUrl` (spec §5, tâche 5) : `httpUrlSchema` avec la sémantique nullable de
 * `nullableTextField` — `''`/`null` → `null`, absent → `undefined`. */
export const nullableHttpUrlSchema = z
  .union([z.literal(''), z.null(), httpUrlSchema])
  .optional()
  .transform((value) => (value === '' || value === null ? null : value));

// Date calendaire AAAA-MM-JJ (colonne `@db.Date`, jamais d'heure) : `z.string().date()`
// (utilisé par `profile.ts`/`resume.ts`) ne valide que le format, pas le calendrier
// réel (`2026-02-30` passerait) — un `refine` supplémentaire reconstruit la date en
// UTC et vérifie qu'elle « rebondit » sur les mêmes année/mois/jour.
const ISO_DATE_PATTERN = /^(\d{4})-(\d{2})-(\d{2})$/;

export const isoDateSchema = z
  .string()
  .regex(ISO_DATE_PATTERN, 'Date invalide.')
  .refine((value) => {
    const match = ISO_DATE_PATTERN.exec(value);
    if (!match) return false;
    const [, yearRaw, monthRaw, dayRaw] = match;
    if (yearRaw === undefined || monthRaw === undefined || dayRaw === undefined) return false;
    const year = Number(yearRaw);
    const month = Number(monthRaw);
    const day = Number(dayRaw);
    const date = new Date(Date.UTC(year, month - 1, day));
    return date.getUTCFullYear() === year && date.getUTCMonth() === month - 1 && date.getUTCDate() === day;
  }, 'Date invalide.');

// Identifiant référencé (jobId, resumeId, coverLetterId) : mêmes bornes que
// les identifiants `cuid` du reste du contrat (`resume.ts`).
const requiredIdSchema = (message = 'Ce champ est obligatoire.') =>
  z.string().trim().min(1, message).max(64, 'Identifiant invalide.');
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
// Création (spec §4/§6) : dispatcher « depuis une offre » / « manuelle »
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
    jobTitle: applicationTextField(160, { min: 1 }),
    company: nullableTextField(120),
    source: applicationSourceSchema.default('OTHER'),
    sourceUrl: nullableHttpUrlSchema,
    locationLabel: nullableTextField(120),
    salaryLabel: nullableTextField(80),
    contractLabel: nullableTextField(80),
    status: applicationStatusSchema.default('TO_APPLY'),
    appliedAt: isoDateSchema.nullable().optional(),
    resumeId: nullableIdSchema,
    usedBaseResume: z.boolean().default(false),
    notes: nullableTextField(4000, { multiline: true }),
  })
  .strict()
  .superRefine(refineCvExclusivity);

export type CreateManualInput = z.output<typeof createManualSchema>;
export type CreateManualFormInput = z.input<typeof createManualSchema>;

/** Repartition entre les deux branches de création (spec §4) : présence de la clé `jobId`
 * (et non sa valeur — `{ jobId: undefined }` doit rester la branche « depuis une offre », pas
 * basculer silencieusement vers la branche manuelle) distingue « depuis une offre » de
 * « manuelle ». */
function pickCreateBranch(value: unknown): typeof createFromJobSchema | typeof createManualSchema {
  return typeof value === 'object' && value !== null && 'jobId' in value ? createFromJobSchema : createManualSchema;
}

/**
 * Union des deux branches de création (spec §4) : un `z.union` brut, à l'échec des deux
 * branches, ne renvoie qu'un seul message générique (« Invalid input ») sans chemin de champ —
 * inutilisable pour afficher une erreur précise dans un formulaire (ex. `{ source: 'LINKEDIN' }`
 * devrait signaler `jobTitle` manquant, pas un échec global). `pickCreateBranch` choisit la
 * branche pertinente d'après la forme de l'entrée, ce dispatcher valide avec cette seule
 * branche et répercute ses erreurs (message + chemin) telles quelles via `ctx.addIssue`, puis
 * renvoie sa sortie déjà typée (`z.NEVER` sur la branche en échec — jamais lue, le parse global
 * ayant déjà échoué).
 */
export const createApplicationSchema = z
  .unknown()
  .transform((value, ctx): CreateFromJobInput | CreateManualInput => {
    const schema = pickCreateBranch(value);
    const result = schema.safeParse(value);
    if (!result.success) {
      for (const issue of result.error.issues) ctx.addIssue(issue);
      return z.NEVER;
    }
    return result.data;
  });

export type CreateApplicationInput = CreateFromJobInput | CreateManualInput;
export type CreateApplicationFormInput = CreateFromJobFormInput | CreateManualFormInput;

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
    notes: nullableTextField(4000, { multiline: true }),
    jobTitle: applicationTextField(160, { min: 1 }).optional(),
    company: nullableTextField(120),
    source: applicationSourceSchema.optional(),
    sourceUrl: nullableHttpUrlSchema,
    locationLabel: nullableTextField(120),
    salaryLabel: nullableTextField(80),
    contractLabel: nullableTextField(80),
  })
  .strict()
  .superRefine((data, ctx) => {
    // `Object.keys(data).length` ne fonctionne pas ici : Zod pose toujours toutes les clés du
    // shape sur la sortie d'un objet, y compris `undefined` pour un champ optionnel absent de
    // l'entrée (cf. le même constat documenté par `omitUndefinedValues`, profile.ts) — `data`
    // porte donc toujours toutes les clés, jamais un objet vide. Seule la présence d'au moins
    // une valeur *définie* signale une modification réelle.
    const hasAnyField = Object.values(data).some((value) => value !== undefined);
    if (!hasAnyField) {
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
    position: z.number().int().min(0, 'Position invalide.').max(500, 'Position invalide.'),
  })
  .strict();

export type MoveApplicationInput = z.output<typeof moveApplicationSchema>;

// ---------------------------------------------------------------------------
// Liste (spec §6) — query string
// ---------------------------------------------------------------------------

// Valeur brute que `page`/`limit` peuvent porter : une chaîne (querystring), ou un nombre pour
// un appel programmatique direct du contrat. Ni tableau ni booléen — à la différence des champs
// multi-valeurs de `jobSearchQuerySchema` (jobs.ts), `page`/`limit` sont des scalaires uniques ;
// les exclure ici (plutôt qu'un `z.coerce.number()` nu, qui coercerait silencieusement `true` en
// 1 et `[]` en 0) fait échouer la validation dès qu'une valeur de ce type est fournie.
const scalarNumericField = z.union([z.string(), z.number()]).optional();

// Plafond défensif (spec, revue sécurité), comme `MAX_PAGE` dans `jobs.ts` : sans lui, une page
// arbitrairement grande traduit un `OFFSET` tout aussi arbitraire dans la requête Prisma.
const MAX_PAGE = 500;

const pageSchema = scalarNumericField
  .transform((value) => (value === undefined || value === '' ? 1 : value))
  .pipe(z.coerce.number().int().min(1, 'Page invalide.').max(MAX_PAGE, 'Page trop élevée.'));

const limitSchema = scalarNumericField
  .transform((value) => (value === undefined || value === '' ? 20 : value))
  .pipe(z.coerce.number().int().min(1, 'Limite invalide.').max(50, 'Limite invalide.'));

export const applicationListQuerySchema = z.object({
  tab: applicationTabSchema.default('all'),
  q: z
    .string()
    .trim()
    .max(120, 'Maximum 120 caractères.')
    .optional()
    .transform((value) => (value === undefined || value === '' ? undefined : value)),
  page: pageSchema,
  limit: limitSchema,
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
