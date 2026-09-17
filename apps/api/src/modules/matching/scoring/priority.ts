import { PRIORITY_THRESHOLDS, type JobRequirements, type MatchPriority } from '@jobtrack/shared';
import { allRequiredTechnologiesCovered } from './factors/skills';
import type { JobInputs, ProfileInputs } from './types';

const MS_PER_DAY = 24 * 60 * 60 * 1000;
/** Fraîcheur maximale (en jours) pour la priorité `VERY_HIGH` (spec §5). */
const VERY_HIGH_MAX_AGE_DAYS = 3;

function isPublishedWithin(publishedAt: Date, now: Date, maxAgeDays: number): boolean {
  const ageDays = (now.getTime() - publishedAt.getTime()) / MS_PER_DAY;
  return ageDays <= maxAgeDays;
}

/**
 * Priorité de candidature (spec §5) : jamais formulée comme une probabilité.
 * `VERY_HIGH` exige, en plus du score, que toutes les technologies exigées
 * soient couvertes par le profil et que l'offre ait été publiée depuis 3
 * jours au plus ; les autres paliers ne dépendent que du score.
 */
export function computePriority(
  score: number,
  profile: ProfileInputs,
  job: JobInputs,
  requirements: JobRequirements,
  now: Date,
): MatchPriority {
  if (
    score >= PRIORITY_THRESHOLDS.VERY_HIGH &&
    allRequiredTechnologiesCovered(profile, job, requirements) &&
    isPublishedWithin(job.publishedAt, now, VERY_HIGH_MAX_AGE_DAYS)
  ) {
    return 'VERY_HIGH';
  }
  if (score >= PRIORITY_THRESHOLDS.HIGH) return 'HIGH';
  if (score >= PRIORITY_THRESHOLDS.GOOD) return 'GOOD';
  if (score >= PRIORITY_THRESHOLDS.CONSIDER) return 'CONSIDER';
  return 'LOW';
}
