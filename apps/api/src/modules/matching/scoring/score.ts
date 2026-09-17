import { SCORE_BAND_THRESHOLDS, type JobRequirements, type MatchBand, type MatchFactorDto } from '@jobtrack/shared';
import { buildExplanation } from './explanation';
import { scoreContract } from './factors/contract';
import { scoreEducation } from './factors/education';
import { scoreExperience } from './factors/experience';
import { scoreLanguages } from './factors/languages';
import { scoreLocation } from './factors/location';
import { scoreRemote } from './factors/remote';
import { scoreSalary } from './factors/salary';
import { scoreSkills } from './factors/skills';
import { computePriority } from './priority';
import { relevanceScore } from './relevance';
import type { JobInputs, MatchResult, ProfileInputs } from './types';

/** Sous ce ratio du poids total, les facteurs évalués sont jugés trop peu nombreux pour un score fiable (spec §5). */
const MINIMUM_EVALUATED_WEIGHT_RATIO = 0.5;

function bandFromScore(score: number): MatchBand {
  if (score >= SCORE_BAND_THRESHOLDS.EXCELLENT) return 'EXCELLENT';
  if (score >= SCORE_BAND_THRESHOLDS.GOOD) return 'GOOD';
  if (score >= SCORE_BAND_THRESHOLDS.PARTIAL) return 'PARTIAL';
  return 'WEAK';
}

/**
 * Moteur de score déterministe (spec §5) : calcule les 8 facteurs, en déduit
 * un score global (moyenne pondérée renormalisée sur les facteurs
 * `evaluated`), une bande, une priorité et l'explication du classement. Le
 * score reste `null` (« Données insuffisantes pour un score fiable ») quand
 * les facteurs évalués représentent moins de 50 % du poids total — jamais de
 * pourcentage inventé (cahier des charges §6).
 */
export function scoreJob(profile: ProfileInputs, job: JobInputs, requirements: JobRequirements, now: Date): MatchResult {
  const factors: MatchFactorDto[] = [
    scoreSkills(profile, job, requirements, now),
    scoreExperience(profile, job, requirements, now),
    scoreLocation(profile, job, requirements, now),
    scoreSalary(profile, job, requirements, now),
    scoreContract(profile, job, requirements, now),
    scoreRemote(profile, job, requirements, now),
    scoreEducation(profile, job, requirements, now),
    scoreLanguages(profile, job, requirements, now),
  ];

  const totalWeight = factors.reduce((sum, factor) => sum + factor.weight, 0);
  const evaluated = factors.filter((factor) => factor.status === 'evaluated' && factor.score !== null);
  const evaluatedWeight = evaluated.reduce((sum, factor) => sum + factor.weight, 0);
  const insufficientData = evaluatedWeight < totalWeight * MINIMUM_EVALUATED_WEIGHT_RATIO;

  let score: number | null = null;
  let band: MatchBand | null = null;
  let relevance: number | null = null;

  if (!insufficientData && evaluatedWeight > 0) {
    const weightedSum = evaluated.reduce((sum, factor) => sum + (factor.score ?? 0) * factor.weight, 0);
    score = Math.round(weightedSum / evaluatedWeight);
    band = bandFromScore(score);
    relevance = relevanceScore(score, job.publishedAt, now);
  }

  const priority = score === null ? null : computePriority(score, profile, job, requirements, now);
  const explanation = buildExplanation(factors, job.publishedAt, now);

  return { score, band, priority, relevance, factors, explanation, insufficientData };
}
