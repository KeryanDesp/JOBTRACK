import { z } from 'zod';
import { contractTypeSchema, experienceLevelSchema, remoteModeSchema } from './profile';

// ---------------------------------------------------------------------------
// Enumerations
// ---------------------------------------------------------------------------

// Seule source dont l'acces automatise est autorise pour l'instant (cf. spec
// tranche 3, §1) ; extensible plus tard (Adzuna, Jooble...) sans casser ce
// contrat, chaque nouvelle source n'ajoutant qu'une valeur ici.
export const JOB_SOURCE_KINDS = ['FRANCE_TRAVAIL'] as const;
export const jobSourceKindSchema = z.enum(JOB_SOURCE_KINDS);
export type JobSourceKind = z.infer<typeof jobSourceKindSchema>;

// `ContractType`/`RemoteMode`/`ExperienceLevel` sont les enumerations du profil
// (préférences de recherche) : les offres partagent exactement les mêmes
// valeurs, d'où la réutilisation plutôt qu'une redéfinition qui pourrait
// diverger au fil du temps.
export type ContractType = z.infer<typeof contractTypeSchema>;
export type RemoteMode = z.infer<typeof remoteModeSchema>;
export type ExperienceLevel = z.infer<typeof experienceLevelSchema>;

export const JOB_SORT_VALUES = ['recent', 'salary'] as const;
const jobSortSchema = z.enum(JOB_SORT_VALUES);
export type JobSort = z.infer<typeof jobSortSchema>;

export const JOB_TAB_VALUES = ['all', 'new'] as const;
const jobTabSchema = z.enum(JOB_TAB_VALUES);
export type JobTab = z.infer<typeof jobTabSchema>;

const publishedWithinDaysValueSchema = z.union([
  z.literal(1),
  z.literal(3),
  z.literal(7),
  z.literal(14),
  z.literal(31),
]);
export type PublishedWithinDays = z.infer<typeof publishedWithinDaysValueSchema>;

// ---------------------------------------------------------------------------
// jobSearchQuerySchema — helpers de normalisation
// ---------------------------------------------------------------------------

// Une clé de `URLSearchParams` regroupée (voir `parseJobSearchParams`) peut
// porter une seule valeur ou plusieurs (paramètre répété). `firstValue` ramène
// ça à « la » valeur utile pour un champ scalaire (les valeurs répétées en
// trop sont ignorées plutôt que de faire échouer tout le parsing).
function firstValue(value: string | string[] | boolean | undefined): string | boolean | undefined {
  return Array.isArray(value) ? value[0] : value;
}

// Pour un champ tableau : valeurs répétées ET valeurs séparées par des
// virgules sont toutes deux acceptées (`?contractTypes=CDI&contractTypes=CDD`
// et `?contractTypes=CDI,CDD` produisent le même résultat).
function toValueList(value: string | string[] | undefined): string[] {
  if (value === undefined) return [];
  const parts = Array.isArray(value) ? value : [value];
  return parts.flatMap((part) => part.split(','));
}

function dedupeTrimmed(values: string[]): string[] {
  const trimmed = values.map((value) => value.trim()).filter((value) => value.length > 0);
  return Array.from(new Set(trimmed));
}

// Type d'entrée brut commun à la plupart des champs : ce qu'un
// `URLSearchParams` regroupé peut réellement produire pour une clé (absente,
// une valeur, ou plusieurs valeurs répétées).
const rawField = z.union([z.string(), z.array(z.string())]).optional();

const communeCodeRegex = /^(\d{5}|2[AB]\d{3})$/;

const qSchema = rawField.transform((value) => firstValue(value) ?? '').pipe(z.string().trim().max(120));

const communesSchema = rawField
  .transform((value) => dedupeTrimmed(toValueList(value)))
  .pipe(z.array(z.string().regex(communeCodeRegex, 'Code commune invalide.')).max(3, 'Maximum 3 communes.'));

const distanceSchema = rawField
  .transform((value) => firstValue(value) || '10')
  .pipe(z.coerce.number().int().min(0).max(100));

const contractTypesSchema = rawField
  .transform((value) => dedupeTrimmed(toValueList(value)))
  .pipe(z.array(contractTypeSchema));

const remoteModesSchema = rawField
  .transform((value) => dedupeTrimmed(toValueList(value)))
  .pipe(z.array(remoteModeSchema));

const experienceLevelsSchema = rawField
  .transform((value) => dedupeTrimmed(toValueList(value)))
  .pipe(z.array(experienceLevelSchema));

const sourcesSchema = rawField
  .transform((value) => dedupeTrimmed(toValueList(value)))
  .pipe(z.array(jobSourceKindSchema));

// Optionnel (pas de défaut) : `''` (clé présente mais vide) est traité comme
// « absent » plutôt que d'être coercé en `0` par `Number('')`.
const salaryMinSchema = rawField
  .transform((value) => {
    const single = firstValue(value);
    return single === '' ? undefined : single;
  })
  .pipe(z.coerce.number().int().min(0).max(1_000_000).optional());

const publishedWithinDaysSchema = rawField
  .transform((value) => {
    const single = firstValue(value);
    return single === '' ? undefined : single;
  })
  .pipe(z.coerce.number().int().pipe(publishedWithinDaysValueSchema).optional());

const sortSchema = rawField.transform((value) => firstValue(value) || 'recent').pipe(jobSortSchema);

const tabSchema = rawField.transform((value) => firstValue(value) || 'all').pipe(jobTabSchema);

const pageSchema = rawField.transform((value) => firstValue(value) || '1').pipe(z.coerce.number().int().min(1));

const pageSizeSchema = rawField
  .transform((value) => firstValue(value) || '20')
  .pipe(z.coerce.number().int())
  .pipe(z.literal(20));

// `refresh` peut aussi arriver comme booléen (appel programmatique du contrat,
// hors `URLSearchParams`), d'où l'union élargie plutôt que `rawField`.
const refreshRawField = z.union([z.string(), z.array(z.string()), z.boolean()]).optional();
const refreshSchema = refreshRawField
  .transform((value) => {
    const single = firstValue(value);
    return single === true || single === '1' || single === 'true';
  })
  .pipe(z.boolean());

export const jobSearchQuerySchema = z.object({
  q: qSchema,
  communes: communesSchema,
  distance: distanceSchema,
  contractTypes: contractTypesSchema,
  remoteModes: remoteModesSchema,
  experienceLevels: experienceLevelsSchema,
  salaryMin: salaryMinSchema,
  publishedWithinDays: publishedWithinDaysSchema,
  sources: sourcesSchema,
  sort: sortSchema,
  tab: tabSchema,
  page: pageSchema,
  pageSize: pageSizeSchema,
  refresh: refreshSchema,
});
// Les clés inconnues sont retirées silencieusement : `z.object` (sans
// `.passthrough()`/`.strict()`) applique déjà ce comportement par défaut.

export type JobSearchQuery = z.output<typeof jobSearchQuerySchema>;
export type JobSearchQueryInput = z.input<typeof jobSearchQuerySchema>;

/**
 * Construit un `JobSearchQuery` à partir d'un `URLSearchParams` (état de la
 * recherche dans l'URL, cf. spec §2). Les clés répétées (`?communes=75001&
 * communes=69001`) sont regroupées en tableau avant validation.
 *
 * En cas d'échec de validation (ex. un code commune malformé), la fonction ne
 * renvoie jamais un mélange partiel de valeurs valides et de défauts : elle
 * retombe entièrement sur les valeurs par défaut du contrat. Une recherche
 * dont un seul champ est corrompu (lien partagé tronqué, saisie manuelle de
 * l'URL) redémarre donc proprement plutôt que d'exposer un état incohérent.
 */
export function parseJobSearchParams(params: URLSearchParams): JobSearchQuery {
  const grouped: Record<string, string | string[]> = {};
  // `.forEach()` plutôt qu'une boucle `for...of`/`.keys()` : ces dernières
  // exigent un protocole d'itération dont le typage varie selon la
  // bibliothèque de lib résolue à la génération des déclarations (`tsup`),
  // alors que `.forEach()` est déclaré de façon identique partout.
  params.forEach((_value, key) => {
    if (key in grouped) return;
    const values = params.getAll(key);
    // `values` contient toujours au moins un élément ici (la clé vient de
    // `params` lui-même) ; le repli sur `''` ne sert qu'à satisfaire
    // `noUncheckedIndexedAccess`, jamais atteint en pratique.
    grouped[key] = values.length > 1 ? values : values[0] ?? '';
  });
  const result = jobSearchQuerySchema.safeParse(grouped);
  return result.success ? result.data : jobSearchQuerySchema.parse({});
}

// ---------------------------------------------------------------------------
// DTO (dates en chaînes ISO)
// ---------------------------------------------------------------------------

export interface JobSummaryDto {
  id: string;
  title: string;
  company: string | null;
  companyLogoUrl: string | null;
  locationLabel: string | null;
  departmentCode: string | null;
  contractType: ContractType | null;
  contractLabel: string | null;
  remoteMode: RemoteMode | null;
  remoteModeInferred: boolean;
  experienceLevel: ExperienceLevel | null;
  salaryMinAnnual: number | null;
  salaryMaxAnnual: number | null;
  salaryLabel: string | null;
  currency: string;
  publishedAt: string;
  expiredAt: string | null;
  /** Jusqu'à 3 compétences, les compétences exigées passant en premier. */
  skills: string[];
  sources: JobSourceKind[];
  saved: boolean;
}

export interface JobSourceDto {
  kind: JobSourceKind;
  externalId: string;
  url: string;
  applyUrl: string | null;
  partnerName: string | null;
  publishedAt: string;
}

export interface JobSkillDto {
  name: string;
  required: boolean;
}

export interface JobRequirementDto {
  kind: 'EDUCATION' | 'LANGUAGE';
  label: string;
  required: boolean;
}

export interface JobDetailDto extends JobSummaryDto {
  description: string;
  companyDescription: string | null;
  companyUrl: string | null;
  communeCode: string | null;
  postalCode: string | null;
  latitude: number | null;
  longitude: number | null;
  contractNature: string | null;
  experienceLabel: string | null;
  experienceRequired: boolean | null;
  workingTimeLabel: string | null;
  isFullTime: boolean | null;
  isApprenticeship: boolean;
  positionsCount: number | null;
  accessibleTh: boolean | null;
  sectorLabel: string | null;
  romeCode: string | null;
  romeLabel: string | null;
  qualificationLabel: string | null;
  sourceUpdatedAt: string | null;
  lastSeenAt: string;
  sourceDetails: JobSourceDto[];
  skillDetails: JobSkillDto[];
  requirements: JobRequirementDto[];
}

export type SyncStatus = 'ok' | 'cached' | 'degraded' | 'not_configured';

export interface JobSyncInfoDto {
  status: SyncStatus;
  syncedAt: string | null;
  message: string | null;
}

export interface JobListResponseDto {
  items: JobSummaryDto[];
  total: number;
  page: number;
  pageSize: number;
  sync: JobSyncInfoDto;
}

export interface CommuneDto {
  code: string;
  name: string;
  postalCode: string | null;
  departmentCode: string;
}

export interface JobsCapabilitiesDto {
  sources: {
    franceTravail: boolean;
  };
}

// ---------------------------------------------------------------------------
// Libellés français
// ---------------------------------------------------------------------------

export const CONTRACT_TYPE_LABELS: Record<ContractType, string> = {
  CDI: 'CDI',
  CDD: 'CDD',
  INTERIM: 'Intérim',
  INTERNSHIP: 'Stage',
  APPRENTICESHIP: 'Alternance',
  FREELANCE: 'Freelance',
  PART_TIME: 'Temps partiel',
};

export const REMOTE_MODE_LABELS: Record<RemoteMode, string> = {
  ONSITE: 'Sur site',
  HYBRID: 'Hybride',
  REMOTE: 'Télétravail',
};

export const EXPERIENCE_LEVEL_LABELS: Record<ExperienceLevel, string> = {
  STUDENT: 'Étudiant',
  JUNIOR: 'Junior',
  MID: 'Confirmé',
  SENIOR: 'Senior',
  LEAD: 'Lead',
};

export const JOB_SOURCE_LABELS: Record<JobSourceKind, string> = {
  FRANCE_TRAVAIL: 'France Travail',
};

export const PUBLISHED_WITHIN_OPTIONS: { value: PublishedWithinDays; label: string }[] = [
  { value: 1, label: '24 heures' },
  { value: 3, label: '3 jours' },
  { value: 7, label: '7 jours' },
  { value: 14, label: '14 jours' },
  { value: 31, label: '31 jours' },
];

export const JOB_SORT_OPTIONS: { value: JobSort; label: string }[] = [
  { value: 'recent', label: 'Plus récentes' },
  { value: 'salary', label: 'Salaire' },
];

export const JOB_TABS: { value: JobTab; label: string }[] = [
  { value: 'all', label: 'Toutes' },
  { value: 'new', label: 'Nouvelles' },
];
