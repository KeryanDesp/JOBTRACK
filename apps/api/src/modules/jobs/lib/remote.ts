import type { RemoteMode } from '@prisma/client';

/**
 * Détection heuristique du télétravail dans le titre et la description d'une
 * offre France Travail (aucun champ dédié dans l'API). Le résultat est
 * toujours une annonce (`remoteModeInferred=true` côté appelant), jamais un
 * fait certain — cf. spec §5. Une négation (« pas de télétravail »…) prévaut
 * sur toute mention positive trouvée ailleurs dans le texte.
 */

/** Retire les diacritiques et met en minuscules, pour des motifs insensibles aux accents et à la casse. */
function normalize(text: string): string {
  return text.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
}

const NEGATION_PATTERN =
  /\bteletravail non possible\b|\bteletravail impossible\b|\bpas de teletravail\b|\baucun teletravail\b|\bsans teletravail\b/;

const REMOTE_PATTERN =
  /\bteletravail (complet|total|integral)\b|\bteletravail a 100\s*%|\bfull remote\b|\b100\s*%\s*remote\b|\bremote total\b/;

const HYBRID_PATTERN =
  /\bhybride\b|\bteletravail partiel\b|\bteletravail possible\b|\bteletravail occasionnel\b|\d+\s*jours?\s*(?:par semaine\s*)?de teletravail\b|\ben teletravail\s*\d+\s*jours?\b|\bremote partiel\b/;

const MENTION_PATTERN = /\bteletravail\b|\bremote\b/;

/**
 * Analyse `text` (titre + description) et renvoie le mode de télétravail
 * détecté, ou `null` si rien n'est trouvé ou si une négation est présente.
 */
export function detectRemoteMode(text: string): RemoteMode | null {
  const normalized = normalize(text);

  if (NEGATION_PATTERN.test(normalized)) return null;
  if (REMOTE_PATTERN.test(normalized)) return 'REMOTE';
  if (HYBRID_PATTERN.test(normalized)) return 'HYBRID';
  if (MENTION_PATTERN.test(normalized)) return 'HYBRID';
  return null;
}
