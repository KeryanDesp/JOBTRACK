import type { MatchFactorDto } from '@jobtrack/shared';

const MS_PER_HOUR = 60 * 60 * 1000;
const MAX_TOP_LINES = 3;
const MAX_WEAK_LINES = 2;
const PUBLISHED_TODAY_MAX_HOURS = 24;

/** Trie les facteurs évalués du plus favorable au moins favorable (score décroissant, poids décroissant en cas d'égalité). */
function sortBestFirst(factors: readonly MatchFactorDto[]): MatchFactorDto[] {
  return [...factors].sort((a, b) => (b.score ?? 0) - (a.score ?? 0) || b.weight - a.weight);
}

/** Trie les facteurs évalués du moins favorable au plus favorable (score croissant, poids décroissant en cas d'égalité). */
function sortWorstFirst(factors: readonly MatchFactorDto[]): MatchFactorDto[] {
  return [...factors].sort((a, b) => (a.score ?? 0) - (b.score ?? 0) || b.weight - a.weight);
}

/**
 * Explication du classement (spec §5, §48) : `top` reprend jusqu'à 3 lignes
 * `ok` (une par facteur, les facteurs les mieux notés d'abord), puis ajoute
 * « Publiée aujourd'hui » si l'offre a moins de 24 h ; `weak` reprend jusqu'à
 * 2 lignes `missing`/`warn` des facteurs les moins bien notés. Toutes les
 * lignes proviennent du moteur, jamais du modèle.
 */
export function buildExplanation(factors: readonly MatchFactorDto[], publishedAt: Date, now: Date): { top: string[]; weak: string[] } {
  const evaluated = factors.filter((factor) => factor.status === 'evaluated' && factor.score !== null);

  const top: string[] = [];
  for (const factor of sortBestFirst(evaluated)) {
    if (top.length >= MAX_TOP_LINES) break;
    const okEvidence = factor.evidence.find((evidence) => evidence.kind === 'ok');
    if (okEvidence) top.push(okEvidence.text);
  }

  const ageHours = (now.getTime() - publishedAt.getTime()) / MS_PER_HOUR;
  if (ageHours < PUBLISHED_TODAY_MAX_HOURS) {
    top.push('Publiée aujourd\'hui');
  }

  const weak: string[] = [];
  for (const factor of sortWorstFirst(evaluated)) {
    if (weak.length >= MAX_WEAK_LINES) break;
    const badEvidence = factor.evidence.find((evidence) => evidence.kind === 'missing' || evidence.kind === 'warn');
    if (badEvidence) weak.push(badEvidence.text);
  }

  return { top, weak };
}
