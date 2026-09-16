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
  return text
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase();
}

const NEGATION_PATTERN =
  /\bteletravail non possible\b|\bteletravail impossible\b|\bpas de teletravail\b|\baucun teletravail\b|\bsans teletravail\b|\bteletravail\s*:\s*non\b|\bteletravail non\b|\bteletravail n['’]?est pas possible\b|\bteletravail refuse\b|\bteletravail non autorise\b|\bteletravail exclu\b/;

const REMOTE_PATTERN =
  /\bteletravail (complet|total|integral)\b|\bteletravail a 100\s*%|\bfull remote\b|\b100\s*%\s*remote\b|\bremote total\b/;

/**
 * Les quantificateurs sur le nombre de jours sont bornés à deux chiffres
 * (`\d{1,2}`, jamais plus de 99 jours par semaine) : un `\d+` non borné suivi
 * d'un motif qui échoue in fine (ex. un très long texte de chiffres sans le
 * mot « jours ») fait backtracker le moteur caractère par caractère depuis
 * chaque position de départ — un comportement O(n²) sur une entrée hostile.
 */
const HYBRID_PATTERN =
  /\bhybride\b|\bteletravail partiel\b|\bteletravail possible\b|\bteletravail occasionnel\b|\d{1,2}\s*jours?\s*(?:par semaine\s*)?de teletravail\b|\ben teletravail\s*\d{1,2}\s*jours?\b|\bremote partiel\b/;

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
