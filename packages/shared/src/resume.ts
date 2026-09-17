import { z } from 'zod';
// `zod/v4` : seul noyau que `zodOutputFormat` du SDK Anthropic sait convertir en
// JSON Schema (cf. `cv-import.ts`, `cvExtractionWireSchema` ; `matching.ts`,
// `jobRequirementsWireSchema`). Réservé aux schémas « fil » ci-dessous
// (`resumeTailoringWireSchema`, `coverLetterWireSchema`) ; le reste du fichier
// reste sur l'API classique (zod v3).
import { z as zWire } from 'zod/v4';
import { languageSchema, skillSchema } from './profile';
import type {
  CertificationInput,
  EducationInput,
  ExperienceInput,
  LanguageInput,
  ProjectInput,
  SkillInput,
} from './profile';

// ---------------------------------------------------------------------------
// Énumérations
// ---------------------------------------------------------------------------

export const RESUME_TEMPLATES = ['CLASSIC', 'MODERN'] as const;
export const resumeTemplateSchema = z.enum(RESUME_TEMPLATES);
export type ResumeTemplate = z.infer<typeof resumeTemplateSchema>;

export const COVER_LETTER_TONES = ['SHORT', 'PROFESSIONAL', 'PERSONAL'] as const;
export const coverLetterToneSchema = z.enum(COVER_LETTER_TONES);
export type CoverLetterTone = z.infer<typeof coverLetterToneSchema>;

export const RESUME_VERSION_SOURCES = ['AI', 'USER'] as const;
export const resumeVersionSourceSchema = z.enum(RESUME_VERSION_SOURCES);
export type ResumeVersionSource = z.infer<typeof resumeVersionSourceSchema>;

// Catégories/niveaux de compétence et niveau de langue : mêmes énumérations que
// `profile.ts` (`skillSchema`, `languageSchema`), réutilisées plutôt que
// redéfinies pour ne jamais diverger. `skillSchema` porte un `.default(...)`
// sur `category`/`level` (nécessaire pour la saisie de formulaire) ; un
// document de CV auto-porteur ne doit en revanche jamais poser ce défaut
// silencieusement — `.removeDefault()` retire le défaut sans dupliquer la
// liste des valeurs. `languageSchema.level` n'a pas de défaut : le schéma brut
// est réutilisé tel quel.
const resumeSkillCategorySchema = skillSchema.shape.category.removeDefault();
const resumeSkillLevelSchema = skillSchema.shape.level.removeDefault();
const resumeLanguageLevelSchema = languageSchema.shape.level;

// ---------------------------------------------------------------------------
// resumeContentSchema (spec §4) — document JSON versionné, autoporteur
// ---------------------------------------------------------------------------

// Date calendaire AAAA-MM-JJ, comme `isoDate` (profile.ts), mais nullable : le
// document de CV peut porter une expérience/formation sans date reconnue
// (import, saisie manuelle ultérieure) plutôt que d'échouer entièrement.
const resumeDateSchema = z.string().date('Date invalide (AAAA-MM-JJ attendu).').nullable();

const httpUrlSchema = z
  .string()
  .trim()
  .max(2000, 'Maximum 2000 caractères.')
  .url('URL invalide.')
  .refine((value) => /^https?:$/.test(new URL(value).protocol), 'URL invalide.');

const nullableHttpUrlSchema = z.union([z.null(), httpUrlSchema]);

const resumeLinkSchema = z
  .object({
    label: z.string().trim().min(1, 'Ce champ est obligatoire.').max(60),
    url: httpUrlSchema,
  })
  .strict();

// Coordonnées optionnelles (absence de la clé, jamais `null`) : `buildBaseResume`
// avec `includeContact: false` (entrée IA) les omet complètement plutôt que de
// les mettre à `null`, pour qu'elles n'apparaissent nulle part dans le document
// envoyé au modèle (spec §5, §8 — coordonnées jamais envoyées à l'IA).
const resumeIdentitySchema = z
  .object({
    firstName: z.string().trim().min(1, 'Ce champ est obligatoire.').max(80),
    lastName: z.string().trim().min(1, 'Ce champ est obligatoire.').max(80),
    title: z.string().trim().max(120).nullable(),
    email: z.string().trim().max(254).email('Email invalide.').optional(),
    phone: z.string().trim().max(30).optional(),
    city: z.string().trim().max(80).optional(),
    country: z.string().trim().max(80).optional(),
    links: z.array(resumeLinkSchema).max(5).optional(),
  })
  .strict();

const resumeExperienceSchema = z
  .object({
    id: z.string().trim().min(1).max(64),
    company: z.string().trim().min(1, 'Ce champ est obligatoire.').max(120),
    role: z.string().trim().min(1, 'Ce champ est obligatoire.').max(120),
    location: z.string().trim().max(120).nullable(),
    startDate: resumeDateSchema,
    endDate: resumeDateSchema,
    isCurrent: z.boolean(),
    highlights: z.array(z.string().trim().min(1).max(300)).max(6),
    sourceDescription: z.string().trim().max(2000).nullable(),
  })
  .strict();

const resumeEducationSchema = z
  .object({
    id: z.string().trim().min(1).max(64),
    school: z.string().trim().min(1, 'Ce champ est obligatoire.').max(120),
    degree: z.string().trim().min(1, 'Ce champ est obligatoire.').max(120),
    field: z.string().trim().max(120).nullable(),
    startDate: resumeDateSchema,
    endDate: resumeDateSchema,
  })
  .strict();

const resumeSkillSchema = z
  .object({
    id: z.string().trim().min(1).max(64),
    name: z.string().trim().min(1, 'Ce champ est obligatoire.').max(60),
    category: resumeSkillCategorySchema,
    level: resumeSkillLevelSchema,
  })
  .strict();

const resumeLanguageSchema = z
  .object({
    id: z.string().trim().min(1).max(64),
    name: z.string().trim().min(1, 'Ce champ est obligatoire.').max(60),
    level: resumeLanguageLevelSchema,
  })
  .strict();

const resumeCertificationSchema = z
  .object({
    id: z.string().trim().min(1).max(64),
    name: z.string().trim().min(1, 'Ce champ est obligatoire.').max(120),
    issuer: z.string().trim().min(1, 'Ce champ est obligatoire.').max(120),
    issuedAt: resumeDateSchema,
  })
  .strict();

const resumeProjectSchema = z
  .object({
    id: z.string().trim().min(1).max(64),
    name: z.string().trim().min(1, 'Ce champ est obligatoire.').max(120),
    description: z.string().trim().max(400).nullable(),
    url: nullableHttpUrlSchema,
    technologies: z.array(z.string().trim().min(1).max(80)).max(20),
  })
  .strict();

export const resumeContentSchema = z
  .object({
    schemaVersion: z.literal(1),
    identity: resumeIdentitySchema,
    summary: z.string().trim().max(1200),
    experiences: z.array(resumeExperienceSchema).max(30),
    educations: z.array(resumeEducationSchema).max(20),
    skills: z.array(resumeSkillSchema).max(60),
    languages: z.array(resumeLanguageSchema).max(20),
    certifications: z.array(resumeCertificationSchema).max(20),
    projects: z.array(resumeProjectSchema).max(20),
  })
  .strict();

export type ResumeContent = z.output<typeof resumeContentSchema>;
export type ResumeContentExperience = ResumeContent['experiences'][number];
export type ResumeContentEducation = ResumeContent['educations'][number];
export type ResumeContentSkill = ResumeContent['skills'][number];
export type ResumeContentLanguage = ResumeContent['languages'][number];
export type ResumeContentCertification = ResumeContent['certifications'][number];
export type ResumeContentProject = ResumeContent['projects'][number];

// ---------------------------------------------------------------------------
// buildBaseResume — construction pure depuis le profil (mêmes DTO que `/profile`)
// ---------------------------------------------------------------------------

/**
 * Identité source du CV : les champs de coordonnées viennent du profil
 * (`ProfileDto`, `apps/web/src/services/api/profile.ts`) à l'exception de
 * `email`, qui n'existe pas sur le profil (c'est l'email du compte,
 * `User.email`) — à charge de l'appelant (API) de le fournir ici. Aucun champ
 * `linkedinUrl`/`websiteUrl` n'existe aujourd'hui sur le profil (vérifié :
 * absent de `profile.ts`, de `ProfileDto` et du schéma Prisma) : `links`
 * restera donc toujours vide tant qu'un tel champ n'est pas ajouté au profil ;
 * c'est une déviation par rapport à l'énoncé de la tâche, qui anticipait ces
 * champs.
 */
export interface ResumeSourceIdentity {
  firstName: string;
  lastName: string;
  title: string | null;
  summary: string | null;
  email: string;
  phone: string | null;
  city: string | null;
  country: string | null;
}

export interface ResumeSourceExperience extends ExperienceInput {
  id: string;
  sortOrder: number;
}

export interface ResumeSourceEducation extends EducationInput {
  id: string;
  sortOrder: number;
}

export interface ResumeSourceSkill extends SkillInput {
  id: string;
  sortOrder: number;
}

export interface ResumeSourceLanguage extends LanguageInput {
  id: string;
  sortOrder: number;
}

export interface ResumeSourceCertification extends CertificationInput {
  id: string;
  sortOrder: number;
}

export interface ResumeSourceProject extends ProjectInput {
  id: string;
  sortOrder: number;
}

export interface ResumeSourceProfile extends ResumeSourceIdentity {
  experiences: ResumeSourceExperience[];
  educations: ResumeSourceEducation[];
  skills: ResumeSourceSkill[];
  languages: ResumeSourceLanguage[];
  certifications: ResumeSourceCertification[];
  projects: ResumeSourceProject[];
}

export interface BuildBaseResumeOptions {
  /**
   * `false` retire email/téléphone/liens du document (entrée envoyée à l'IA,
   * spec §5/§8) ; `true` (défaut) les inclut, pour le CV principal affiché à
   * l'utilisateur.
   */
  includeContact?: boolean;
}

const BULLET_PREFIX_RE = /^[-•*–]\s*/;

/**
 * Découpe une description libre (profil) en puces (spec §4/tâche 2) : les
 * lignes commençant par `-`, `•`, `*` ou `–` sont reconnues comme des puces
 * existantes (préfixe retiré) ; à défaut d'une seule ligne ainsi préfixée, la
 * description est découpée en phrases (séparateur `. `). Résultat tronqué à 6
 * puces, chacune bornée à 300 caractères ; les lignes/phrases vides sont
 * écartées. `null`/chaîne vide → `[]`.
 */
export function splitDescriptionIntoHighlights(description: string | null | undefined): string[] {
  if (!description) return [];
  const trimmed = description.trim();
  if (trimmed === '') return [];

  const lines = trimmed
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line.length > 0);
  const hasBullets = lines.some((line) => BULLET_PREFIX_RE.test(line));

  const items = hasBullets
    ? lines.map((line) => line.replace(BULLET_PREFIX_RE, '').trim()).filter((line) => line.length > 0)
    : lines
        .join(' ')
        .split(/\.\s+/)
        .map((sentence) => sentence.trim().replace(/\.$/, ''))
        .filter((sentence) => sentence.length > 0);

  return items.slice(0, 6).map((item) => (item.length > 300 ? item.slice(0, 300) : item));
}

// Comparaison lexicale valide sur des dates AAAA-MM-JJ ou `null` (traité comme
// « le plus récent » : poste actuel ou formation en cours).
function compareDatesDesc(a: string | null, b: string | null): number {
  if (a === b) return 0;
  if (a === null) return -1;
  if (b === null) return 1;
  return a < b ? 1 : -1;
}

/**
 * Ordre du CV de base pour les expériences (spec/tâche 2 : « poste actuel en
 * premier, puis dates décroissantes ») : `isCurrent` d'abord, puis
 * `startDate` décroissant, puis `sortOrder` (ordre du profil) en dernier
 * recours pour une comparaison stable entre postes strictement identiques.
 */
function sortExperiences(items: ResumeSourceExperience[]): ResumeSourceExperience[] {
  return [...items].sort((a, b) => {
    if (a.isCurrent !== b.isCurrent) return a.isCurrent ? -1 : 1;
    const byDate = compareDatesDesc(a.startDate, b.startDate);
    if (byDate !== 0) return byDate;
    return a.sortOrder - b.sortOrder;
  });
}

/**
 * Formations : pas de champ `isCurrent`, une formation sans `endDate` est
 * traitée comme en cours (même logique que `compareDatesDesc`, `null` en tête).
 */
function sortEducations(items: ResumeSourceEducation[]): ResumeSourceEducation[] {
  return [...items].sort((a, b) => {
    const byEndDate = compareDatesDesc(a.endDate ?? null, b.endDate ?? null);
    if (byEndDate !== 0) return byEndDate;
    const byStartDate = compareDatesDesc(a.startDate, b.startDate);
    if (byStartDate !== 0) return byStartDate;
    return a.sortOrder - b.sortOrder;
  });
}

function sortCertifications(items: ResumeSourceCertification[]): ResumeSourceCertification[] {
  return [...items].sort((a, b) => {
    const byDate = compareDatesDesc(a.issuedAt, b.issuedAt);
    if (byDate !== 0) return byDate;
    return a.sortOrder - b.sortOrder;
  });
}

// Sans date exploitable pour le CV (compétences, langues, projets) : seul
// l'ordre manuel du profil (`sortOrder`, `reorderCollection`) s'applique.
function bySortOrder<T extends { sortOrder: number }>(a: T, b: T): number {
  return a.sortOrder - b.sortOrder;
}

// Les schémas de saisie du profil (`optionalText`, profile.ts) typent leur
// sortie `string | null | undefined` : `undefined` n'apparaît en pratique que
// pour une clé jamais posée par `omitUndefinedValues` (non appliqué par
// `experienceSchema`/`educationSchema`/`projectSchema`) ; le document de CV,
// lui, veut une clé toujours présente (`null`, jamais `undefined`).
function orNull<T>(value: T | null | undefined): T | null {
  return value ?? null;
}

function toResumeExperience(item: ResumeSourceExperience): ResumeContentExperience {
  return {
    id: item.id,
    company: item.company,
    role: item.role,
    location: orNull(item.location),
    startDate: item.startDate,
    endDate: orNull(item.endDate),
    isCurrent: item.isCurrent,
    highlights: splitDescriptionIntoHighlights(item.description),
    sourceDescription: orNull(item.description),
  };
}

function toResumeEducation(item: ResumeSourceEducation): ResumeContentEducation {
  return {
    id: item.id,
    school: item.school,
    degree: item.degree,
    field: orNull(item.field),
    startDate: item.startDate,
    endDate: orNull(item.endDate),
  };
}

function toResumeSkill(item: ResumeSourceSkill): ResumeContentSkill {
  return { id: item.id, name: item.name, category: item.category, level: item.level };
}

function toResumeLanguage(item: ResumeSourceLanguage): ResumeContentLanguage {
  return { id: item.id, name: item.name, level: item.level };
}

function toResumeCertification(item: ResumeSourceCertification): ResumeContentCertification {
  return { id: item.id, name: item.name, issuer: item.issuer, issuedAt: item.issuedAt };
}

function toResumeProject(item: ResumeSourceProject): ResumeContentProject {
  const description = item.description == null ? null : item.description.slice(0, 400);
  return { id: item.id, name: item.name, description, url: orNull(item.url), technologies: item.technologies };
}

/**
 * Construit le document de CV (spec §4) depuis le profil de l'utilisateur —
 * fonction pure, partagée web/API. `includeContact: false` (défaut `true`)
 * retire email/téléphone/ville/pays/liens (entrée IA, spec §5/§8).
 */
export function buildBaseResume(profile: ResumeSourceProfile, options: BuildBaseResumeOptions = {}): ResumeContent {
  const includeContact = options.includeContact ?? true;

  const identity: ResumeContent['identity'] = {
    firstName: profile.firstName,
    lastName: profile.lastName,
    title: profile.title,
    ...(includeContact && { email: profile.email }),
    ...(includeContact && profile.phone !== null && { phone: profile.phone }),
    ...(includeContact && profile.city !== null && { city: profile.city }),
    ...(includeContact && profile.country !== null && { country: profile.country }),
  };

  return {
    schemaVersion: 1,
    identity,
    summary: profile.summary ?? '',
    experiences: sortExperiences(profile.experiences).map(toResumeExperience),
    educations: sortEducations(profile.educations).map(toResumeEducation),
    skills: [...profile.skills].sort(bySortOrder).map(toResumeSkill),
    languages: [...profile.languages].sort(bySortOrder).map(toResumeLanguage),
    certifications: sortCertifications(profile.certifications).map(toResumeCertification),
    projects: [...profile.projects].sort(bySortOrder).map(toResumeProject),
  };
}

// ---------------------------------------------------------------------------
// Adaptation IA (spec §4/§5) : `resumeTailoringSchema` (v3, tolérant) et
// `resumeTailoringWireSchema` (v4, strict — sortie structurée Anthropic)
// ---------------------------------------------------------------------------

/**
 * Filtre une liste d'éléments potentiellement mal formés (sortie du modèle) :
 * chaque élément est validé isolément et un élément invalide est écarté
 * plutôt que de faire échouer toute la liste (même principe que `filterRows`,
 * `matching.ts`/`sanitizeDraftList`, `cv-import.ts` — dupliqué ici plutôt que
 * partagé, comme le fait déjà chacun de ces fichiers). Tronquée à `maxItems`
 * après filtrage ; une valeur qui n'est pas un tableau devient une liste vide.
 */
function filterTailoringRows<Output>(schema: z.ZodType<Output, z.ZodTypeDef, unknown>, maxItems: number) {
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

const tailoringExperienceRowSchema = z.object({
  id: z.string().trim().min(1).max(64),
  keep: z.boolean().default(true),
  order: z.number().int().min(0),
  highlights: z.array(z.string().trim().min(1).max(300)).max(6).default([]),
});

const tailoringKeepRowSchema = z.object({
  id: z.string().trim().min(1).max(64),
  keep: z.boolean().default(true),
});

const tailoringOrderRowSchema = z.object({
  id: z.string().trim().min(1).max(64),
  order: z.number().int().min(0),
});

const tailoringProjectRowSchema = z.object({
  id: z.string().trim().min(1).max(64),
  keep: z.boolean().default(true),
  order: z.number().int().min(0),
});

/**
 * Sortie de l'adaptation IA (spec §4), tolérante : des identifiants inconnus
 * du profil peuvent y figurer (c'est à l'API de les filtrer, elle seule
 * connaît le profil courant) ; une ligne mal formée est écartée plutôt que de
 * faire échouer toute l'adaptation.
 */
export const resumeTailoringSchema = z.object({
  title: z.string().trim().max(120).default(''),
  summary: z.string().trim().max(1200).default(''),
  experiences: filterTailoringRows(tailoringExperienceRowSchema, 30),
  educations: filterTailoringRows(tailoringKeepRowSchema, 20),
  skills: filterTailoringRows(tailoringOrderRowSchema, 60),
  certifications: filterTailoringRows(tailoringKeepRowSchema, 20),
  projects: filterTailoringRows(tailoringProjectRowSchema, 20),
  notes: z.string().trim().max(300).default(''),
});

export type ResumeTailoringInput = z.output<typeof resumeTailoringSchema>;

const tailoringExperienceRowWireSchema = zWire
  .object({
    id: zWire.string().max(64),
    keep: zWire.boolean(),
    order: zWire.number().int().min(0),
    highlights: zWire.array(zWire.string().max(300)).max(6),
  })
  .strict();

const tailoringKeepRowWireSchema = zWire
  .object({
    id: zWire.string().max(64),
    keep: zWire.boolean(),
  })
  .strict();

const tailoringOrderRowWireSchema = zWire
  .object({
    id: zWire.string().max(64),
    order: zWire.number().int().min(0),
  })
  .strict();

const tailoringProjectRowWireSchema = zWire
  .object({
    id: zWire.string().max(64),
    keep: zWire.boolean(),
    order: zWire.number().int().min(0),
  })
  .strict();

/**
 * Miroir plat de `resumeTailoringSchema` pour `zodOutputFormat` (mêmes
 * contraintes que `cvExtractionWireSchema`/`jobRequirementsWireSchema` : pas
 * d'union/transform/refine/default, toutes les clés requises, `maxItems`
 * reprenant les bornes ci-dessus).
 */
export const resumeTailoringWireSchema = zWire
  .object({
    title: zWire.string().max(120),
    summary: zWire.string().max(1200),
    experiences: zWire.array(tailoringExperienceRowWireSchema).max(30),
    educations: zWire.array(tailoringKeepRowWireSchema).max(20),
    skills: zWire.array(tailoringOrderRowWireSchema).max(60),
    certifications: zWire.array(tailoringKeepRowWireSchema).max(20),
    projects: zWire.array(tailoringProjectRowWireSchema).max(20),
    notes: zWire.string().max(300),
  })
  .strict();

export type ResumeTailoringWire = zWire.infer<typeof resumeTailoringWireSchema>;

// ---------------------------------------------------------------------------
// Lettre de motivation (spec §4/§5)
// ---------------------------------------------------------------------------

export const coverLetterContentSchema = z
  .object({
    recipient: z.string().trim().max(120).nullable(),
    subject: z.string().trim().max(160),
    greeting: z.string().trim().max(80),
    paragraphs: z.array(z.string().trim().min(1).max(900)).min(1).max(6),
    closing: z.string().trim().max(160),
    signature: z.string().trim().max(80),
  })
  .strict();

export type CoverLetterContent = z.output<typeof coverLetterContentSchema>;

export const coverLetterWireSchema = zWire
  .object({
    recipient: zWire.string().max(120).nullable(),
    subject: zWire.string().max(160),
    greeting: zWire.string().max(80),
    paragraphs: zWire.array(zWire.string().max(900)).min(1).max(6),
    closing: zWire.string().max(160),
    signature: zWire.string().max(80),
  })
  .strict();

export type CoverLetterWire = zWire.infer<typeof coverLetterWireSchema>;

/** Bornes de longueur du texte assemblé (paragraphes) par ton (spec §5). */
export const COVER_LETTER_MAX_CHARS: Record<CoverLetterTone, number> = {
  SHORT: 900,
  PROFESSIONAL: 1800,
  PERSONAL: 2600,
};

// ---------------------------------------------------------------------------
// resumeChangesSchema (spec §4/§42) — diff avant/après par section
// ---------------------------------------------------------------------------

const beforeAfterTextSchema = z
  .object({
    before: z.string(),
    after: z.string(),
  })
  .strict();

const changesRejectedHighlightSchema = z
  .object({
    index: z.number().int().min(0),
    reason: z.string().max(300),
  })
  .strict();

const changesExperienceSchema = z
  .object({
    id: z.string().min(1).max(64),
    before: z.array(z.string().max(300)).max(6),
    after: z.array(z.string().max(300)).max(6),
    kept: z.boolean(),
    rejected: z.array(changesRejectedHighlightSchema).max(6),
  })
  .strict();

const changesIdListSchema = (max: number) => z.array(z.string().min(1).max(64)).max(max);

const changesSkillsSchema = z
  .object({
    before: changesIdListSchema(60),
    after: changesIdListSchema(60),
  })
  .strict();

const changesKeptRemovedSchema = (max: number) =>
  z
    .object({
      kept: changesIdListSchema(max),
      removed: changesIdListSchema(max),
    })
    .strict();

export const resumeChangesSchema = z
  .object({
    title: beforeAfterTextSchema,
    summary: beforeAfterTextSchema,
    experiences: z.array(changesExperienceSchema).max(30),
    skills: changesSkillsSchema,
    educations: changesKeptRemovedSchema(20),
    certifications: changesKeptRemovedSchema(20),
    projects: changesKeptRemovedSchema(20),
    notes: z.string().max(300).nullable(),
  })
  .strict();

export type ResumeChanges = z.output<typeof resumeChangesSchema>;

// ---------------------------------------------------------------------------
// Entrées des routes (spec §6)
// ---------------------------------------------------------------------------

export const createTailoredResumeSchema = z
  .object({
    jobId: z.string().trim().min(1, 'Ce champ est obligatoire.').max(64),
    template: resumeTemplateSchema,
  })
  .strict();

export type CreateTailoredResumeInput = z.output<typeof createTailoredResumeSchema>;

export const updateResumeSchema = z
  .object({
    content: resumeContentSchema,
    template: resumeTemplateSchema.optional(),
  })
  .strict();

export type UpdateResumeInput = z.output<typeof updateResumeSchema>;

export const updateResumeTemplateSchema = z
  .object({
    template: resumeTemplateSchema,
  })
  .strict();

export type UpdateResumeTemplateInput = z.output<typeof updateResumeTemplateSchema>;

export const createCoverLetterSchema = z
  .object({
    jobId: z.string().trim().min(1, 'Ce champ est obligatoire.').max(64),
    tone: coverLetterToneSchema,
    resumeId: z.string().trim().min(1).max(64).optional(),
  })
  .strict();

export type CreateCoverLetterInput = z.output<typeof createCoverLetterSchema>;

export const updateCoverLetterSchema = z
  .object({
    content: coverLetterContentSchema,
  })
  .strict();

export type UpdateCoverLetterInput = z.output<typeof updateCoverLetterSchema>;

// ---------------------------------------------------------------------------
// DTO (dates en chaînes ISO)
// ---------------------------------------------------------------------------

export interface ResumeSummaryDto {
  id: string;
  title: string;
  jobId: string | null;
  jobTitle: string | null;
  company: string | null;
  template: ResumeTemplate;
  currentVersion: number;
  createdAt: string;
  updatedAt: string;
}

export interface ResumeVersionInfoDto {
  number: number;
  source: ResumeVersionSource;
  model: string | null;
  promptVersion: number | null;
  createdAt: string;
}

export interface ResumeDto extends ResumeSummaryDto {
  content: ResumeContent;
  changes: ResumeChanges | null;
  version: ResumeVersionInfoDto;
}

export interface BaseResumeDto {
  content: ResumeContent;
  template: ResumeTemplate;
  profileComplete: boolean;
}

export interface CoverLetterSummaryDto {
  id: string;
  jobId: string | null;
  jobTitle: string | null;
  company: string | null;
  resumeId: string | null;
  tone: CoverLetterTone;
  createdAt: string;
  updatedAt: string;
}

export interface CoverLetterDto extends CoverLetterSummaryDto {
  content: CoverLetterContent;
}

// ---------------------------------------------------------------------------
// Libellés français
// ---------------------------------------------------------------------------

export const RESUME_TEMPLATE_LABELS: Record<ResumeTemplate, string> = {
  CLASSIC: 'Classique',
  MODERN: 'Moderne',
};

export const COVER_LETTER_TONE_LABELS: Record<CoverLetterTone, string> = {
  SHORT: 'Courte',
  PROFESSIONAL: 'Professionnelle',
  PERSONAL: 'Très personnalisée',
};

export const RESUME_SECTION_LABELS = {
  identity: 'Identité',
  summary: 'Résumé',
  experiences: 'Expériences',
  educations: 'Formations',
  skills: 'Compétences',
  languages: 'Langues',
  certifications: 'Certifications',
  projects: 'Projets',
} as const;

export type ResumeSection = keyof typeof RESUME_SECTION_LABELS;

// ---------------------------------------------------------------------------
// resumeFileName — assainissement ASCII (spec §2/§8)
// ---------------------------------------------------------------------------

/**
 * Réduit une chaîne à un segment de nom de fichier ASCII : accents retirés
 * (décomposition NFD puis suppression des diacritiques), toute suite de
 * caractères non alphanumériques (espaces, apostrophes, ponctuation) devient
 * un unique tiret, tirets de tête/queue retirés.
 */
function toAsciiSlug(value: string): string {
  return value
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^A-Za-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

const RESUME_FILE_NAME_MAX_LENGTH = 80;
const PDF_EXTENSION = '.pdf';

/**
 * Nom de fichier du PDF téléchargé (spec §2 : `CV-Prénom-Nom-Entreprise.pdf` /
 * `Lettre-Prénom-Nom-Entreprise.pdf`) : ASCII, tirets, ≤ 80 caractères
 * extension comprise. `company` `null` (offre supprimée, ou lettre/CV sans
 * offre liée) omet simplement ce segment.
 */
export function resumeFileName(
  kind: 'CV' | 'Lettre',
  identity: { firstName: string; lastName: string },
  company: string | null,
): string {
  const segments = [kind, identity.firstName, identity.lastName, company ?? '']
    .map(toAsciiSlug)
    .filter((segment) => segment.length > 0);
  const slug = segments.length > 0 ? segments.join('-') : kind;
  const maxSlugLength = RESUME_FILE_NAME_MAX_LENGTH - PDF_EXTENSION.length;
  const truncated = slug.slice(0, maxSlugLength).replace(/-+$/, '');
  return `${truncated}${PDF_EXTENSION}`;
}
