import { z } from 'zod';
import type { JobApplicationRefDto } from './applications';
import type { MatchScoreSummaryDto } from './matching';
import { contractTypeSchema, experienceLevelSchema, remoteModeSchema } from './profile';

// ---------------------------------------------------------------------------
// Énumérations
// ---------------------------------------------------------------------------

// Seule source dont l'accès automatisé est autorisé pour l'instant (cf. spec
// tranche 3, §1) ; extensible plus tard (Adzuna, Jooble...) sans casser ce
// contrat, chaque nouvelle source n'ajoutant qu'une valeur ici.
export const JOB_SOURCE_KINDS = ['FRANCE_TRAVAIL'] as const;
export const jobSourceKindSchema = z.enum(JOB_SOURCE_KINDS);
export type JobSourceKind = z.infer<typeof jobSourceKindSchema>;

// `ContractType`/`RemoteMode`/`ExperienceLevel` sont les énumérations du profil
// (préférences de recherche) : les offres partagent exactement les mêmes
// valeurs, d'où la réutilisation plutôt qu'une redéfinition qui pourrait
// diverger au fil du temps.
export type ContractType = z.infer<typeof contractTypeSchema>;
export type RemoteMode = z.infer<typeof remoteModeSchema>;
export type ExperienceLevel = z.infer<typeof experienceLevelSchema>;

export const JOB_SORT_VALUES = ['recent', 'salary', 'match', 'relevance'] as const;
export const jobSortSchema = z.enum(JOB_SORT_VALUES);
export type JobSort = z.infer<typeof jobSortSchema>;

export const JOB_TAB_VALUES = ['all', 'new', 'for_you', 'priority'] as const;
export const jobTabSchema = z.enum(JOB_TAB_VALUES);
export type JobTab = z.infer<typeof jobTabSchema>;

// `sort`/`tab` portent une clé d'URL distincte de leur valeur canonique pour
// `relevance`/`for_you`/`priority` (`tri=pertinence`, `onglet=pour-vous`,
// `onglet=priorite` — spec §6) : la table ci-dessous est l'unique source pour
// les deux sens de conversion (`parseJobSearchParams`/`toJobSearchParams`),
// pour qu'ils restent synchronisés. Les autres valeurs gardent leur clé
// canonique comme clé d'URL (identité).
const SORT_URL_VALUES: Record<JobSort, string> = {
  recent: 'recent',
  salary: 'salary',
  match: 'match',
  relevance: 'pertinence',
};

const SORT_FROM_URL: Record<string, JobSort> = Object.fromEntries(
  Object.entries(SORT_URL_VALUES).map(([canonical, url]) => [url, canonical as JobSort]),
);

const TAB_URL_VALUES: Record<JobTab, string> = {
  all: 'all',
  new: 'new',
  for_you: 'pour-vous',
  priority: 'priorite',
};

const TAB_FROM_URL: Record<string, JobTab> = Object.fromEntries(
  Object.entries(TAB_URL_VALUES).map(([canonical, url]) => [url, canonical as JobTab]),
);

export const JOB_REQUIREMENT_KINDS = ['EDUCATION', 'LANGUAGE'] as const;
export const jobRequirementKindSchema = z.enum(JOB_REQUIREMENT_KINDS);
export type JobRequirementKind = z.infer<typeof jobRequirementKindSchema>;

export const JOB_REQUIREMENT_KIND_LABELS: Record<JobRequirementKind, string> = {
  EDUCATION: 'Formation',
  LANGUAGE: 'Langue',
};

// Seule source de vérité pour les cinq bornes autorisées de `publishedWithinDays`
// (libellés et tests s'appuient sur ce tableau plutôt que de le recopier).
export const PUBLISHED_WITHIN_DAYS_VALUES = [1, 3, 7, 14, 31] as const;
export type PublishedWithinDays = (typeof PUBLISHED_WITHIN_DAYS_VALUES)[number];

// `z.union` n'a pas d'équivalent de `z.enum` pour des nombres : les cinq
// valeurs sont donc répétées ici littéralement. `PUBLISHED_WITHIN_DAYS_VALUES`
// ci-dessus reste néanmoins la seule référence utilisée par les libellés et
// par les tests, pour qu'un oubli de mise à jour de l'un des deux soit
// immédiatement détecté par la couverture de test plutôt que de diverger
// silencieusement.
const publishedWithinDaysValueSchema = z.union([
  z.literal(1),
  z.literal(3),
  z.literal(7),
  z.literal(14),
  z.literal(31),
]);

// ---------------------------------------------------------------------------
// jobSearchQuerySchema — helpers de normalisation
// ---------------------------------------------------------------------------

type ScalarValue = string | number | boolean;

// Une clé de `URLSearchParams` regroupée (voir `parseJobSearchParams`) peut
// porter une seule valeur ou plusieurs (paramètre répété) ; un appel
// programmatique du contrat (hors URL) peut aussi passer directement un
// nombre ou un booléen. `firstValue` ramène tout ça à « la » valeur utile pour
// un champ scalaire (les valeurs répétées en trop sont ignorées plutôt que de
// faire échouer tout le parsing).
function firstValue(value: ScalarValue | ScalarValue[] | undefined): ScalarValue | undefined {
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

// Type d'entrée brut commun aux champs texte/tableau : ce qu'un
// `URLSearchParams` regroupé peut réellement produire pour une clé (absente,
// une valeur, ou plusieurs valeurs répétées).
const rawField = z.union([z.string(), z.array(z.string())]).optional();

// Variante pour les champs numériques : un appel programmatique du contrat
// peut aussi fournir directement un nombre — notamment `JobSearchQuery`
// lui-même, dont la sortie (ex. `distance: 10`) doit pouvoir être revalidée
// par ce même schéma (cf. `jobSearchQuerySchema.parse(jobSearchQuerySchema
// .parse({}))` testé dans `jobs.test.ts`).
const rawNumericField = z.union([z.string(), z.array(z.string()), z.number()]).optional();

// Idem pour `refresh`, qui accepte aussi un booléen direct.
const refreshRawField = z.union([z.string(), z.array(z.string()), z.boolean()]).optional();

const communeCodeRegex = /^(\d{5}|2[AB]\d{3})$/;

const qSchema = rawField
  .transform((value) => {
    const single = firstValue(value);
    return single === undefined ? '' : single;
  })
  .pipe(z.string().trim().max(120));

const communesSchema = rawField
  .transform((value) => dedupeTrimmed(toValueList(value)))
  .pipe(z.array(z.string().regex(communeCodeRegex, 'Code commune invalide.')).max(3, 'Maximum 3 communes.'));

// Le repli n'utilise jamais `single || <défaut>` : `0` est une valeur légitime
// (distance nulle, page... non applicable ici, mais le principe est partagé
// avec `page`/`pageSize` ci-dessous) et serait sinon remplacé à tort par le
// défaut, `0` étant falsy en JavaScript.
const distanceSchema = rawNumericField
  .transform((value) => {
    const single = firstValue(value);
    return single === undefined || single === '' ? 10 : single;
  })
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
const salaryMinSchema = rawNumericField
  .transform((value) => {
    const single = firstValue(value);
    return single === '' ? undefined : single;
  })
  .pipe(z.coerce.number().int().min(0).max(1_000_000).optional());

const publishedWithinDaysSchema = rawNumericField
  .transform((value) => {
    const single = firstValue(value);
    return single === '' ? undefined : single;
  })
  .pipe(z.coerce.number().int().pipe(publishedWithinDaysValueSchema).optional());

const sortSchema = rawField
  .transform((value) => {
    const single = firstValue(value);
    if (single === undefined || single === '') return 'recent';
    if (typeof single === 'string' && Object.hasOwn(SORT_FROM_URL, single)) return SORT_FROM_URL[single];
    return single;
  })
  .pipe(jobSortSchema);

const tabSchema = rawField
  .transform((value) => {
    const single = firstValue(value);
    if (single === undefined || single === '') return 'all';
    if (typeof single === 'string' && Object.hasOwn(TAB_FROM_URL, single)) return TAB_FROM_URL[single];
    return single;
  })
  .pipe(jobTabSchema);

// Plafond défensif (spec, revue sécurité) : sans lui, une page arbitrairement grande
// (`?page=1000000000`) traduit un `OFFSET` tout aussi arbitraire dans la requête Prisma —
// jamais un vrai besoin fonctionnel (20 par page, quelques centaines d'offres au plus).
const MAX_PAGE = 500;

const pageSchema = rawNumericField
  .transform((value) => {
    const single = firstValue(value);
    return single === undefined || single === '' ? 1 : single;
  })
  .pipe(z.coerce.number().int().min(1).max(MAX_PAGE));

const pageSizeSchema = rawNumericField
  .transform((value) => {
    const single = firstValue(value);
    return single === undefined || single === '' ? 20 : single;
  })
  .pipe(z.coerce.number().int())
  .pipe(z.literal(20));

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

// ---------------------------------------------------------------------------
// Clés courtes d'URL
// ---------------------------------------------------------------------------

// Nom court utilisé dans l'URL (`?lieu=75001&rayon=20...`) pour chaque champ
// du contrat, `pageSize` exclu (toujours fixé à 20, jamais porté par l'URL).
// Table unique consultée à la fois par `parseJobSearchParams` (lecture) et
// `toJobSearchParams` (écriture), pour que les deux restent synchronisés.
export const JOB_SEARCH_PARAM_KEYS: Record<Exclude<keyof JobSearchQuery, 'pageSize'>, string> = {
  q: 'q',
  communes: 'lieu',
  distance: 'rayon',
  contractTypes: 'contrat',
  remoteModes: 'remote',
  experienceLevels: 'exp',
  salaryMin: 'salaire',
  publishedWithinDays: 'depuis',
  sources: 'source',
  sort: 'tri',
  tab: 'onglet',
  page: 'page',
  refresh: 'refresh',
};

// Sens inverse (clé courte → clé canonique), dérivé de la table ci-dessus
// pour éviter de la dupliquer.
const CANONICAL_PARAM_KEYS: Record<string, string> = Object.fromEntries(
  Object.entries(JOB_SEARCH_PARAM_KEYS).map(([canonical, short]) => [short, canonical]),
);

/**
 * Construit un `JobSearchQuery` à partir d'un `URLSearchParams` (état de la
 * recherche dans l'URL, cf. spec §2), en clés courtes (`JOB_SEARCH_PARAM_KEYS`
 * — ex. `?lieu=75001&rayon=20`, jamais les noms canoniques du contrat). Les
 * clés répétées (`?lieu=75001&lieu=69001`) sont regroupées en tableau avant
 * validation ; les clés courtes inconnues sont ignorées.
 *
 * En cas d'échec de validation (ex. un code commune malformé), la fonction ne
 * réinitialise pas toute la recherche : elle retire uniquement les champs en
 * cause (`issue.path[0]`, le nom canonique porté par chaque erreur) et
 * retente une fois. Ce n'est que si cette seconde tentative échoue encore
 * (cas normalement inatteignable, filet de sécurité) qu'elle retombe sur les
 * valeurs par défaut complètes. Une recherche partagée dont un seul champ est
 * corrompu (lien tronqué, saisie manuelle de l'URL) garde donc les autres
 * critères intacts plutôt que de tout réinitialiser.
 */
export function parseJobSearchParams(params: URLSearchParams): JobSearchQuery {
  const grouped: Record<string, string | string[]> = {};
  // `.forEach()` plutôt qu'une boucle `for...of`/`.keys()` : ces dernières
  // exigent un protocole d'itération dont le typage varie selon la
  // bibliothèque de lib résolue à la génération des déclarations (`tsup`),
  // alors que `.forEach()` est déclaré de façon identique partout.
  params.forEach((_value, shortKey) => {
    // `Object.hasOwn` plutôt qu'un test `=== undefined` sur l'indexation : une clé d'URL
    // nommée `constructor`/`toString`… résoudrait sinon une propriété héritée du prototype
    // de `CANONICAL_PARAM_KEYS` (jamais `undefined`), pas l'absence attendue.
    if (!Object.hasOwn(CANONICAL_PARAM_KEYS, shortKey)) return;
    const canonical = CANONICAL_PARAM_KEYS[shortKey] as string;
    if (canonical in grouped) return;
    const values = params.getAll(shortKey);
    // `values` contient toujours au moins un élément ici (la clé vient de
    // `params` lui-même) ; le repli sur `''` ne sert qu'à satisfaire
    // `noUncheckedIndexedAccess`, jamais atteint en pratique.
    grouped[canonical] = values.length > 1 ? values : values[0] ?? '';
  });

  const firstAttempt = jobSearchQuerySchema.safeParse(grouped);
  if (firstAttempt.success) return firstAttempt.data;

  for (const issue of firstAttempt.error.issues) {
    const field = issue.path[0];
    if (typeof field === 'string') delete grouped[field];
  }
  const retry = jobSearchQuerySchema.safeParse(grouped);
  return retry.success ? retry.data : jobSearchQuerySchema.parse({});
}

/**
 * Sérialise un `JobSearchQuery` en `URLSearchParams` avec les clés courtes
 * (`JOB_SEARCH_PARAM_KEYS`) : opération inverse de `parseJobSearchParams`. Les
 * valeurs égales au défaut du contrat (tableau vide, `distance` 10, `sort`
 * `'recent'`, `tab` `'all'`, `page` 1, `refresh` faux) sont omises pour garder
 * l'URL courte et stable — `pageSize` n'est jamais écrit (fixé à 20). Les
 * tableaux sont joints par des virgules.
 */
export function toJobSearchParams(query: JobSearchQuery): URLSearchParams {
  const params = new URLSearchParams();
  if (query.q !== '') params.set(JOB_SEARCH_PARAM_KEYS.q, query.q);
  if (query.communes.length > 0) params.set(JOB_SEARCH_PARAM_KEYS.communes, query.communes.join(','));
  if (query.distance !== 10) params.set(JOB_SEARCH_PARAM_KEYS.distance, String(query.distance));
  if (query.contractTypes.length > 0) {
    params.set(JOB_SEARCH_PARAM_KEYS.contractTypes, query.contractTypes.join(','));
  }
  if (query.remoteModes.length > 0) {
    params.set(JOB_SEARCH_PARAM_KEYS.remoteModes, query.remoteModes.join(','));
  }
  if (query.experienceLevels.length > 0) {
    params.set(JOB_SEARCH_PARAM_KEYS.experienceLevels, query.experienceLevels.join(','));
  }
  if (query.salaryMin !== undefined) params.set(JOB_SEARCH_PARAM_KEYS.salaryMin, String(query.salaryMin));
  if (query.publishedWithinDays !== undefined) {
    params.set(JOB_SEARCH_PARAM_KEYS.publishedWithinDays, String(query.publishedWithinDays));
  }
  if (query.sources.length > 0) params.set(JOB_SEARCH_PARAM_KEYS.sources, query.sources.join(','));
  if (query.sort !== 'recent') params.set(JOB_SEARCH_PARAM_KEYS.sort, SORT_URL_VALUES[query.sort]);
  if (query.tab !== 'all') params.set(JOB_SEARCH_PARAM_KEYS.tab, TAB_URL_VALUES[query.tab]);
  if (query.page !== 1) params.set(JOB_SEARCH_PARAM_KEYS.page, String(query.page));
  if (query.refresh) params.set(JOB_SEARCH_PARAM_KEYS.refresh, '1');
  return params;
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
  /** Jusqu'à 3 noms de compétences, les compétences exigées passant en premier. */
  skills: string[];
  sources: JobSourceKind[];
  saved: boolean;
  /** `null` : pas encore analysée, IA non configurée, ou profil incomplet (spec §6, tranche 4). */
  match: MatchScoreSummaryDto | null;
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
  kind: JobRequirementKind;
  label: string;
  required: boolean;
}

// `skills`/`sources` sont ré-écrasés avec le détail complet (`JobSkillDto[]`/
// `JobSourceDto[]`) plutôt que les versions allégées de `JobSummaryDto`
// (noms seuls / énumération seule) : le détail n'a pas besoin de porter les
// deux à la fois, d'où l'`Omit` plutôt qu'une extension pure.
export interface JobDetailDto extends Omit<JobSummaryDto, 'skills' | 'sources'> {
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
  skills: JobSkillDto[];
  sources: JobSourceDto[];
  requirements: JobRequirementDto[];
  /** Candidature de l'utilisateur pour cette offre, `null` si non suivie (tranche 6). */
  application: JobApplicationRefDto | null;
}

export type SyncStatus = 'ok' | 'cached' | 'degraded' | 'not_configured';

export interface JobSyncInfoDto {
  status: SyncStatus;
  syncedAt: string | null;
  message: string | null;
  /** Toujours émis par `GET /jobs` (spec §6, tranche 4, tâche 6 — amendement revue) : décompte
   * des offres de la page dont `match` est renseigné, jamais optionnel — un client qui affiche
   * la barre de progression d'analyse n'a pas à distinguer « absent » d'« aucune offre ». */
  analysis: {
    analyzed: number;
    total: number;
    notConfigured: boolean;
  };
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

const PUBLISHED_WITHIN_LABELS: Record<PublishedWithinDays, string> = {
  1: '24 heures',
  3: '3 jours',
  7: '7 jours',
  14: '14 jours',
  31: '31 jours',
};

export const PUBLISHED_WITHIN_OPTIONS: { value: PublishedWithinDays; label: string }[] =
  PUBLISHED_WITHIN_DAYS_VALUES.map((value) => ({ value, label: PUBLISHED_WITHIN_LABELS[value] }));

export const JOB_SORT_OPTIONS: { value: JobSort; label: string }[] = [
  { value: 'recent', label: 'Plus récentes' },
  { value: 'salary', label: 'Salaire' },
  { value: 'match', label: 'Meilleur match' },
  { value: 'relevance', label: 'Pertinence' },
];

export const JOB_TABS: { value: JobTab; label: string }[] = [
  { value: 'all', label: 'Toutes' },
  { value: 'new', label: 'Nouvelles' },
  { value: 'for_you', label: 'Pour vous' },
  { value: 'priority', label: 'Forte priorité' },
];

// ---------------------------------------------------------------------------
// Mise en forme partagée
// ---------------------------------------------------------------------------

/**
 * Fourchette de salaire annuel (spec §7 : « 45–70 k€ », « à partir de 30 k€ »,
 * « jusqu'à 40 k€ »). `null` quand aucune des deux bornes n'est connue —
 * jamais une estimation inventée (cahier des charges §55, cf. spec §5).
 *
 * EUR reçoit un format compact maison plutôt que `Intl.NumberFormat` : la
 * notation compacte de cette locale répéterait le symbole sur chaque borne
 * (« 45 k€–70 k€ ») au lieu du regroupement attendu par la maquette
 * (« 45–70 k€ »). Les autres devises (peu probables ici, cf. spec §4 — seule
 * l'API France Travail en EUR est branchée) passent par `Intl.NumberFormat`
 * en notation compacte, qui gère alors elle-même le symbole propre à chacune.
 */
export function formatSalaryRange(min: number | null, max: number | null, currency = 'EUR'): string | null {
  if (min === null && max === null) return null;

  if (currency !== 'EUR') {
    const formatter = new Intl.NumberFormat('fr-FR', {
      style: 'currency',
      currency,
      notation: 'compact',
      maximumFractionDigits: 0,
    });
    if (min !== null && max !== null) {
      return min === max ? formatter.format(min) : `${formatter.format(min)}–${formatter.format(max)}`;
    }
    if (min !== null) return `à partir de ${formatter.format(min)}`;
    if (max !== null) return `jusqu'à ${formatter.format(max)}`;
    // Inatteignable : le premier retour couvre déjà le cas des deux bornes nulles.
    return null;
  }

  // La borne de référence pour décider de l'unité (k€ ou brut) est toujours
  // `max` quand elle est connue, même si `min` est seul sous 1000 : les deux
  // bornes d'une même fourchette partagent une seule unité, jamais l'une en
  // milliers et l'autre brute.
  const reference = max ?? min;
  const compact = reference !== null && Math.abs(reference) >= 1000;
  const unit = compact ? 'k€' : '€';
  const boundText = (value: number) => (compact ? String(Math.round(value / 1000)) : String(value));

  if (min !== null && max !== null) {
    return min === max ? `${boundText(min)} ${unit}` : `${boundText(min)}–${boundText(max)} ${unit}`;
  }
  if (min !== null) return `à partir de ${boundText(min)} ${unit}`;
  if (max !== null) return `jusqu'à ${boundText(max)} ${unit}`;

  // Inatteignable : le premier retour couvre déjà le cas des deux bornes nulles.
  return null;
}
