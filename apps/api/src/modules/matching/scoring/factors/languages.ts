import type { LanguageLevel } from '@prisma/client';
import type { JobRequirements, LanguageLevelReq, MatchEvidenceDto, MatchFactorDto } from '@jobtrack/shared';
import { normalizeForKey } from '../../../jobs/lib/text';
import type { JobInputs, ProfileInputs } from '../types';
import { evaluatedFactor, unknownFactor } from './support';

/** Ordre des niveaux CECRL, du plus faible au plus élevé (`native` mappé sur `NATIVE`). */
const LANGUAGE_LEVEL_ORDER: readonly LanguageLevel[] = ['A1', 'A2', 'B1', 'B2', 'C1', 'C2', 'NATIVE'];

/** Niveau requis (`jobRequirementsSchema`, lettres minuscules pour `native`) vers l'énumération Prisma partagée avec le profil. */
const REQUIREMENT_LEVEL_TO_PRISMA: Record<LanguageLevelReq, LanguageLevel> = {
  A1: 'A1',
  A2: 'A2',
  B1: 'B1',
  B2: 'B2',
  C1: 'C1',
  C2: 'C2',
  native: 'NATIVE',
};

/** Libellés d'affichage des niveaux de langue. */
const LANGUAGE_LEVEL_LABELS: Record<LanguageLevel, string> = {
  A1: 'A1',
  A2: 'A2',
  B1: 'B1',
  B2: 'B2',
  C1: 'C1',
  C2: 'C2',
  NATIVE: 'langue maternelle',
};

/**
 * Petite table d'alias fr/en pour les noms de langue les plus courants
 * (spec §5) : une entrée non listée reste sa propre clé normalisée, donc
 * « Anglais » et « anglais » se comparent déjà sans alias grâce à
 * `normalizeForKey`.
 */
const LANGUAGE_ALIASES: Readonly<Record<string, string>> = {
  english: 'anglais',
  french: 'francais',
  german: 'allemand',
  spanish: 'espagnol',
  italian: 'italien',
};

function canonicalLanguageName(name: string): string {
  const key = normalizeForKey(name);
  return LANGUAGE_ALIASES[key] ?? key;
}

function levelIndex(level: LanguageLevel): number {
  return LANGUAGE_LEVEL_ORDER.indexOf(level);
}

interface RequiredLanguage {
  name: string;
  level: LanguageLevelReq | null;
}

/**
 * Langues exigées à évaluer : celles de l'analyse (`requirements.languages`)
 * si elle en a extrait au moins une, sinon un repli sur les exigences France
 * Travail brutes (`JobInputs.languages`, `JobRequirement` Prisma de kind
 * `LANGUAGE`) — même principe de repli que le facteur Compétences. Ces
 * dernières n'ont pas de niveau CECRL (seulement un libellé et un booléen
 * `required`) : `level: null` retombe sur le seuil minimal `A1`, donc leur
 * simple présence dans le profil suffit à satisfaire l'exigence.
 */
function effectiveRequiredLanguages(job: JobInputs, requirements: JobRequirements): RequiredLanguage[] {
  const fromAnalysis = requirements.languages.filter((language) => language.required);
  if (fromAnalysis.length > 0) {
    return fromAnalysis.map((language) => ({ name: language.name, level: language.level }));
  }
  return job.languages.filter((language) => language.required).map((language) => ({ name: language.label, level: null }));
}

/**
 * Facteur Langues (poids 5, spec §5) : chaque langue exigée est recherchée
 * dans les langues du profil (noms comparés via une petite table d'alias
 * fr/en) — présente au niveau demandé (100), présente en dessous (60),
 * absente (0) — la moyenne des langues exigées donne le score. `unknown` si
 * ni l'analyse ni l'offre n'exigent de langue.
 */
export function scoreLanguages(profile: ProfileInputs, job: JobInputs, requirements: JobRequirements, _now: Date): MatchFactorDto {
  const required = effectiveRequiredLanguages(job, requirements);
  if (required.length === 0) {
    return unknownFactor('languages', "L'offre n'indique pas d'exigence de langue.");
  }

  const profileByName = new Map<string, LanguageLevel>();
  for (const language of profile.languages) {
    profileByName.set(canonicalLanguageName(language.name), language.level);
  }

  const evidence: MatchEvidenceDto[] = [];
  let total = 0;
  for (const language of required) {
    const requiredLevel = REQUIREMENT_LEVEL_TO_PRISMA[language.level ?? 'A1'];
    const requiredLabel = LANGUAGE_LEVEL_LABELS[requiredLevel];
    const profileLevel = profileByName.get(canonicalLanguageName(language.name));

    if (profileLevel === undefined) {
      evidence.push({ kind: 'missing', text: `${language.name} ${requiredLabel} exigé, absent de votre profil` });
      continue;
    }

    if (levelIndex(profileLevel) >= levelIndex(requiredLevel)) {
      total += 100;
      evidence.push({ kind: 'ok', text: `${language.name} ${requiredLabel} exigé, vous indiquez ${LANGUAGE_LEVEL_LABELS[profileLevel]}` });
    } else {
      total += 60;
      evidence.push({ kind: 'warn', text: `${language.name} ${requiredLabel} exigé, vous indiquez ${LANGUAGE_LEVEL_LABELS[profileLevel]}` });
    }
  }

  const score = Math.round(total / required.length);
  return evaluatedFactor('languages', score, evidence);
}
