import type { ContractType, ExperienceLevel, LanguageLevel, RemoteMode, SkillLevel } from '@prisma/client';
import type { EducationLevel, MatchBand, MatchFactorDto, MatchPriority } from '@jobtrack/shared';

/**
 * Version du moteur de score (poids, seuils, règles de calcul). Incluse dans
 * l'empreinte du profil (`fingerprint.ts`) aux côtés de `SYNONYMS_VERSION` :
 * toute évolution du moteur ou de la table de synonymes doit incrémenter la
 * version concernée pour déclencher un recalcul automatique des scores déjà
 * stockés (spec §5, « Empreinte du profil »).
 */
export const SCORING_VERSION = 1;

/**
 * Entrées profil du moteur de score : construites une fois par requête à
 * partir du `Profile` Prisma (spec §5, « Entrées profil »), sans dépendance à
 * Prisma ni à Nest — uniquement des types scalaires et des dates. `complete`
 * porte la même règle que le bandeau « Complétez vos compétences et
 * expériences… » (spec §2.4) : `true` seulement si au moins une compétence et
 * une expérience sont renseignées.
 */
export interface ProfileInputs {
  skills: { name: string; level: SkillLevel }[];
  projectTechnologies: string[];
  experienceYears: number | null;
  experiences: { startDate: Date; endDate: Date | null; isCurrent: boolean }[];
  educationLevel: EducationLevel | null;
  languages: { name: string; level: LanguageLevel }[];
  preferredCommuneCodes: string[];
  preferredDepartmentCodes: string[];
  salaryMin: number | null;
  salaryMax: number | null;
  contractTypes: ContractType[];
  remoteModes: RemoteMode[];
  experienceLevel: ExperienceLevel | null;
  complete: boolean;
}

/**
 * Entrées offre du moteur de score : champs scalaires du `Job` Prisma
 * utilisés par les facteurs, plus les compétences (`JobSkill`, repli du
 * facteur Compétences quand l'analyse n'a extrait aucune technologie) et les
 * exigences France Travail de langue (`JobRequirement`, kind `LANGUAGE`).
 */
export interface JobInputs {
  communeCode: string | null;
  departmentCode: string | null;
  contractType: ContractType | null;
  remoteMode: RemoteMode | null;
  remoteModeInferred: boolean;
  experienceLevel: ExperienceLevel | null;
  experienceRequired: boolean | null;
  salaryMinAnnual: number | null;
  salaryMaxAnnual: number | null;
  skills: { name: string; required: boolean }[];
  languages: { label: string; required: boolean }[];
  publishedAt: Date;
}

/** Résultat d'un facteur : alias du DTO partagé, la forme est identique côté moteur et côté API. */
export type FactorResult = MatchFactorDto;

/**
 * Résultat complet du moteur (`scoreJob`) : score global, bande, priorité,
 * pertinence (fraîcheur), détail par facteur et explication du classement
 * (spec §5). `insufficientData` porte la règle « moins de 50 % du poids total
 * évalué » — `score`/`band`/`priority`/`relevance` valent alors `null`.
 */
export interface MatchResult {
  score: number | null;
  band: MatchBand | null;
  priority: MatchPriority | null;
  relevance: number | null;
  factors: FactorResult[];
  explanation: { top: string[]; weak: string[] };
  insufficientData: boolean;
}
