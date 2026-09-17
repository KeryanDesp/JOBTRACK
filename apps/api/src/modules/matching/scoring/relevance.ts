const MS_PER_DAY = 24 * 60 * 60 * 1000;

/** Âge (en jours) en dessous duquel la fraîcheur ne pénalise pas encore le score (spec §5 : « 1 jusqu'à 2 jours »). */
const FULL_FRESHNESS_DAYS = 2;
/** Âge (en jours) au-delà duquel la fraîcheur atteint son plancher (spec §5 : « 0,6 à 45 jours »). */
const DECAY_END_DAYS = 45;
/** Plancher du facteur de fraîcheur : une offre ancienne reste comparable, jamais nulle. */
const MIN_FRESHNESS_FACTOR = 0.6;

/**
 * Facteur de fraîcheur `f(âge)` (spec §5) : 1 jusqu'à 2 jours, puis décroît
 * linéairement jusqu'à 0,6 à 45 jours, puis reste à 0,6 (plancher) au-delà.
 */
function freshnessFactor(ageDays: number): number {
  if (ageDays <= FULL_FRESHNESS_DAYS) return 1;
  if (ageDays >= DECAY_END_DAYS) return MIN_FRESHNESS_FACTOR;
  const progress = (ageDays - FULL_FRESHNESS_DAYS) / (DECAY_END_DAYS - FULL_FRESHNESS_DAYS);
  return 1 - progress * (1 - MIN_FRESHNESS_FACTOR);
}

/**
 * Pertinence (tri « Pertinence », spec §5) : le score pondéré par la
 * fraîcheur de publication, pour qu'une offre récente et légèrement moins
 * bonne passe devant une offre ancienne mieux notée (§7 du cahier des
 * charges). Arrondie à l'entier, comme le score.
 */
export function relevanceScore(score: number, publishedAt: Date, now: Date): number {
  const ageDays = Math.max(0, (now.getTime() - publishedAt.getTime()) / MS_PER_DAY);
  return Math.round(score * freshnessFactor(ageDays));
}
