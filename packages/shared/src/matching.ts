import { z } from 'zod';
// `zod/v4` : seul noyau que `zodOutputFormat` du SDK Anthropic sait convertir en
// JSON Schema (cf. `cv-import.ts`, `cvExtractionWireSchema`). Réservé au schéma
// « fil » (`jobRequirementsWireSchema`) ci-dessous ; le reste du fichier reste
// sur l'API classique (zod v3).
import { z as zWire } from 'zod/v4';

// ---------------------------------------------------------------------------
// Énumérations
// ---------------------------------------------------------------------------

export const JOB_ANALYSIS_STATUSES = ['PENDING', 'DONE', 'FAILED'] as const;
export const jobAnalysisStatusSchema = z.enum(JOB_ANALYSIS_STATUSES);
export type JobAnalysisStatus = z.infer<typeof jobAnalysisStatusSchema>;

export const MATCH_BANDS = ['EXCELLENT', 'GOOD', 'PARTIAL', 'WEAK'] as const;
export const matchBandSchema = z.enum(MATCH_BANDS);
export type MatchBand = z.infer<typeof matchBandSchema>;

export const MATCH_PRIORITIES = ['VERY_HIGH', 'HIGH', 'GOOD', 'CONSIDER', 'LOW'] as const;
export const matchPrioritySchema = z.enum(MATCH_PRIORITIES);
export type MatchPriority = z.infer<typeof matchPrioritySchema>;

export const FACTOR_KEYS = [
  'skills',
  'experience',
  'location',
  'salary',
  'contract',
  'remote',
  'education',
  'languages',
] as const;
export const factorKeySchema = z.enum(FACTOR_KEYS);
export type FactorKey = z.infer<typeof factorKeySchema>;

export const TECHNOLOGY_CATEGORIES = [
  'language',
  'framework',
  'tool',
  'cloud',
  'database',
  'methodology',
  'other',
] as const;
export const technologyCategorySchema = z.enum(TECHNOLOGY_CATEGORIES);
export type TechnologyCategory = z.infer<typeof technologyCategorySchema>;

export const SENIORITIES = ['junior', 'mid', 'senior', 'lead'] as const;
export const senioritySchema = z.enum(SENIORITIES);
export type Seniority = z.infer<typeof senioritySchema>;

export const EDUCATION_LEVELS = ['none', 'bac', 'bac2', 'bac3', 'bac5', 'phd'] as const;
export const educationLevelSchema = z.enum(EDUCATION_LEVELS);
export type EducationLevel = z.infer<typeof educationLevelSchema>;

export const REQUIREMENT_REMOTE_MODES = ['onsite', 'hybrid', 'remote'] as const;
export const requirementRemoteModeSchema = z.enum(REQUIREMENT_REMOTE_MODES);
export type RequirementRemoteMode = z.infer<typeof requirementRemoteModeSchema>;

export const LANGUAGE_LEVELS_REQ = ['A1', 'A2', 'B1', 'B2', 'C1', 'C2', 'native'] as const;
export const languageLevelReqSchema = z.enum(LANGUAGE_LEVELS_REQ);
export type LanguageLevelReq = z.infer<typeof languageLevelReqSchema>;

// ---------------------------------------------------------------------------
// jobRequirementsSchema (zod v3, tolérant) — helpers de normalisation
// ---------------------------------------------------------------------------

/**
 * Filtre une liste d'éléments potentiellement mal formés (sortie d'un modèle,
 * relecture d'une colonne `Json`) : chaque élément est validé isolément par
 * `schema` et un élément invalide est écarté plutôt que de faire échouer toute
 * la liste (même principe que `sanitizeDraftList`, cv-import.ts). Tronquée à
 * `maxItems` éléments après filtrage. La valeur reçue peut ne pas être un
 * tableau du tout (`null`, chaîne, objet — sortie d'un modèle ou relecture
 * d'une colonne `Json` mal formée) : elle est alors traitée comme une liste
 * vide plutôt que de faire échouer tout le schéma (`z.array` lèverait sinon).
 */
function filterRows<Output>(schema: z.ZodType<Output, z.ZodTypeDef, unknown>, maxItems: number) {
  return z
    .unknown()
    .optional()
    .transform((value) => {
      const items = Array.isArray(value) ? value : [];
      return items
        .flatMap((item) => {
          const result = schema.safeParse(item);
          return result.success ? [result.data] : [];
        })
        .slice(0, maxItems);
    });
}

/**
 * Filtre une liste de chaînes libres : valeurs non-chaînes écartées, espaces
 * superflus retirés, entrées vides écartées, chaque chaîne tronquée à
 * `maxLength` caractères, liste tronquée à `maxItems` éléments. Comme
 * `filterRows`, une valeur qui n'est pas un tableau devient une liste vide.
 */
function filterStrings(maxItems: number, maxLength: number) {
  return z
    .unknown()
    .optional()
    .transform((value) => {
      const items = Array.isArray(value) ? value : [];
      return items
        .filter((item): item is string => typeof item === 'string')
        .map((item) => item.trim())
        .filter((item) => item.length > 0)
        .map((item) => item.slice(0, maxLength))
        .slice(0, maxItems);
    });
}

/** Énumération nullable tolérante : valeur absente/inconnue → `null`, jamais d'échec. */
function tolerantEnumNullable<T extends readonly [string, ...string[]]>(values: T) {
  return z
    .unknown()
    .optional()
    .transform((value): T[number] | null => {
      if (typeof value !== 'string') return null;
      return values.find((candidate) => candidate === value) ?? null;
    });
}

/**
 * Énumération tolérante avec repli : valeur absente/inconnue → `fallback`
 * (plutôt que `null`), pour un champ jamais nullable dans le contrat (ex.
 * `technology.category`, toujours renseignée dans `JobRequirementTechnology`).
 */
function tolerantEnumWithDefault<T extends readonly [string, ...string[]]>(values: T, fallback: T[number]) {
  return z.unknown().transform((value): T[number] => {
    if (typeof value === 'string') {
      const match = values.find((candidate) => candidate === value);
      if (match !== undefined) return match;
    }
    return fallback;
  });
}

/**
 * `experienceYearsMin` tolérant : une valeur non numérique (chaîne non
 * numérique ou vide, texte libre du modèle) devient `null` plutôt que de
 * faire échouer l'extraction ; une valeur numérique est bornée à [0, 40].
 */
const experienceYearsMinSchema = z
  .unknown()
  .optional()
  .transform((value): number | null => {
    if (typeof value === 'string' && value.trim() === '') return null;
    const num = typeof value === 'number' ? value : typeof value === 'string' ? Number(value.trim()) : NaN;
    if (!Number.isFinite(num)) return null;
    return Math.min(40, Math.max(0, num));
  });

const technologyRowSchema = z.object({
  name: z
    .string()
    .trim()
    .min(1)
    .transform((value) => value.slice(0, 80)),
  required: z
    .unknown()
    .optional()
    .transform((value) => value === true),
  // Une catégorie absente/inconnue n'écarte pas la technologie : elle passe
  // sous `'other'`, la ligne restant exploitable par le moteur de score.
  category: tolerantEnumWithDefault(TECHNOLOGY_CATEGORIES, 'other'),
});

const languageRowSchema = z.object({
  name: z
    .string()
    .trim()
    .min(1)
    .transform((value) => value.slice(0, 80)),
  level: tolerantEnumNullable(LANGUAGE_LEVELS_REQ),
  required: z
    .unknown()
    .optional()
    .transform((value) => value === true),
});

export interface JobRequirementTechnology {
  name: string;
  required: boolean;
  category: TechnologyCategory;
}

export interface JobRequirementLanguage {
  name: string;
  level: LanguageLevelReq | null;
  required: boolean;
}

/**
 * Exigences structurées extraites d'une offre par Claude (spec §4) : schéma
 * tolérant, chaque liste filtrée ligne par ligne (une ligne invalide est
 * écartée, jamais toute l'extraction), chaînes bornées, énumérations fermées
 * (valeur inconnue → `null`), sans donnée utilisateur (indépendant du profil).
 */
export const jobRequirementsSchema = z.object({
  technologies: filterRows(technologyRowSchema, 60),
  softSkills: filterStrings(20, 80),
  experienceYearsMin: experienceYearsMinSchema,
  seniority: tolerantEnumNullable(SENIORITIES),
  educationLevel: tolerantEnumNullable(EDUCATION_LEVELS),
  educationFields: filterStrings(10, 80),
  languages: filterRows(languageRowSchema, 10),
  remoteMode: tolerantEnumNullable(REQUIREMENT_REMOTE_MODES),
  contractHints: filterStrings(10, 300),
  mustHaves: filterStrings(20, 300),
  niceToHaves: filterStrings(20, 300),
  summary: z
    .unknown()
    .optional()
    .transform((value) => (typeof value === 'string' ? value.trim().slice(0, 300) : '')),
});

export type JobRequirements = z.output<typeof jobRequirementsSchema>;

// ---------------------------------------------------------------------------
// jobRequirementsWireSchema (zod v4) — miroir plat pour `zodOutputFormat`
// ---------------------------------------------------------------------------

const technologyWireSchema = zWire
  .object({
    name: zWire.string().max(80),
    required: zWire.boolean(),
    category: zWire.enum(TECHNOLOGY_CATEGORIES),
  })
  .strict();

const languageWireSchema = zWire
  .object({
    name: zWire.string().max(80),
    level: zWire.enum(LANGUAGE_LEVELS_REQ).nullable(),
    required: zWire.boolean(),
  })
  .strict();

/**
 * Miroir plat de `jobRequirementsSchema`, sans union/transform/refine/default
 * (`zodOutputFormat` ne sait pas les convertir en JSON Schema, cf.
 * `cvExtractionWireSchema`) : toutes les clés sont requises (nullable à la
 * place d'optionnelles), `maxItems`/`maxLength` reprennent les bornes du
 * schéma tolérant ci-dessus. `jobRequirementsSchema.parse` normalise ensuite
 * cette sortie (défensif : le modèle reste libre d'écrire hors bornes malgré
 * le schéma envoyé).
 */
export const jobRequirementsWireSchema = zWire
  .object({
    technologies: zWire.array(technologyWireSchema).max(60),
    softSkills: zWire.array(zWire.string().max(80)).max(20),
    experienceYearsMin: zWire.number().min(0).max(40).nullable(),
    seniority: zWire.enum(SENIORITIES).nullable(),
    educationLevel: zWire.enum(EDUCATION_LEVELS).nullable(),
    educationFields: zWire.array(zWire.string().max(80)).max(10),
    languages: zWire.array(languageWireSchema).max(10),
    remoteMode: zWire.enum(REQUIREMENT_REMOTE_MODES).nullable(),
    contractHints: zWire.array(zWire.string().max(300)).max(10),
    mustHaves: zWire.array(zWire.string().max(300)).max(20),
    niceToHaves: zWire.array(zWire.string().max(300)).max(20),
    summary: zWire.string().max(300),
  })
  .strict();

export type JobRequirementsWire = zWire.infer<typeof jobRequirementsWireSchema>;

// ---------------------------------------------------------------------------
// analyzeJobsSchema
// ---------------------------------------------------------------------------

/** `POST /jobs/analyses` : jusqu'à 20 identifiants d'offres, dédoublonnés. */
export const analyzeJobsSchema = z.object({
  jobIds: z
    .array(z.string().min(1).max(64))
    .min(1)
    .max(20)
    .transform((ids) => Array.from(new Set(ids))),
});

export type AnalyzeJobsInput = z.output<typeof analyzeJobsSchema>;

// ---------------------------------------------------------------------------
// DTO (dates en chaînes ISO)
// ---------------------------------------------------------------------------

export interface MatchEvidenceDto {
  kind: 'ok' | 'warn' | 'missing' | 'info';
  text: string;
}

export interface MatchFactorDto {
  key: FactorKey;
  label: string;
  weight: number;
  score: number | null;
  status: 'evaluated' | 'unknown';
  evidence: MatchEvidenceDto[];
}

/** Version allégée d'un score, portée par `JobSummaryDto.match` (liste). */
export interface MatchScoreSummaryDto {
  score: number | null;
  band: MatchBand | null;
  priority: MatchPriority | null;
  explanation: {
    top: string[];
    weak: string[];
  };
}

/** Statuts d'analyse d'une offre, tels que renvoyés par `GET /jobs/:id/match`. */
export const MATCH_ANALYSIS_STATUSES = ['none', 'pending', 'done', 'failed', 'ai_not_configured'] as const;
export type MatchAnalysisStatus = (typeof MATCH_ANALYSIS_STATUSES)[number];

/** Score détaillé, `GET /jobs/:id/match` : facteurs, statut d'analyse, causes d'un score `null`. */
export interface MatchScoreDto extends MatchScoreSummaryDto {
  factors: MatchFactorDto[];
  computedAt: string | null;
  analysis: {
    status: MatchAnalysisStatus;
    error: string | null;
  };
  profileComplete: boolean;
  insufficientData: boolean;
}

export interface AnalyzeJobsResponseDto {
  analyzed: number;
  pending: number;
  failed: number;
  notConfigured: boolean;
  profileComplete: boolean;
  scores: Record<string, MatchScoreSummaryDto | null>;
}

// ---------------------------------------------------------------------------
// Libellés français et poids (exportés pour l'UI et le moteur de score)
// ---------------------------------------------------------------------------

export const MATCH_BAND_LABELS: Record<MatchBand, string> = {
  EXCELLENT: 'Très bonne correspondance',
  GOOD: 'Bonne correspondance',
  PARTIAL: 'Correspondance partielle',
  WEAK: 'Faible correspondance',
};

export const PRIORITY_LABELS: Record<MatchPriority, string> = {
  VERY_HIGH: 'Très forte priorité',
  HIGH: 'Forte priorité',
  GOOD: 'Bonne opportunité',
  CONSIDER: 'À considérer',
  LOW: 'Faible correspondance',
};

export const FACTOR_LABELS: Record<FactorKey, string> = {
  skills: 'Compétences et technologies',
  experience: 'Expérience',
  location: 'Localisation',
  salary: 'Salaire',
  contract: 'Contrat',
  remote: 'Télétravail',
  education: 'Formation',
  languages: 'Langues',
};

/** Poids (spec §5) : la somme vaut toujours 100 (`matching.test.ts`). */
export const FACTOR_WEIGHTS: Record<FactorKey, number> = {
  skills: 35,
  experience: 15,
  location: 15,
  salary: 10,
  contract: 10,
  remote: 5,
  education: 5,
  languages: 5,
};

/** Bandes de score (spec §5) : `score ≥ seuil` → bande, dans l'ordre décroissant. */
export const SCORE_BAND_THRESHOLDS: Record<Exclude<MatchBand, 'WEAK'>, number> = {
  EXCELLENT: 85,
  GOOD: 70,
  PARTIAL: 50,
};

/** Seuils de priorité (spec §5) : `score ≥ seuil` → priorité, dans l'ordre décroissant. */
export const PRIORITY_THRESHOLDS: Record<Exclude<MatchPriority, 'LOW'>, number> = {
  VERY_HIGH: 85,
  HIGH: 75,
  GOOD: 60,
  CONSIDER: 45,
};
