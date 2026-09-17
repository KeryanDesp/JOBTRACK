import { stripControlChars } from '../../../common/text/control-chars';

/**
 * Nettoyage de texte pour les offres France Travail : caractères de contrôle et
 * séquences bidi retirés (via le helper commun `stripControlChars`, `keepNewlines`
 * pour préserver les paragraphes), sauts de ligne normalisés, troncature à une
 * longueur maximale sur une frontière de mot.
 */

const ELLIPSIS = '…';

/** Coupe `text` à `max` caractères sur la dernière frontière de mot, avec une ellipse finale. */
function truncateAtWordBoundary(text: string, max: number): string {
  const budget = Math.max(max - ELLIPSIS.length, 0);
  const cut = text.slice(0, budget);
  const lastSpace = cut.lastIndexOf(' ');
  const boundary = lastSpace > 0 ? cut.slice(0, lastSpace) : cut;
  return `${boundary.trimEnd()}${ELLIPSIS}`;
}

/**
 * Nettoie un texte issu d'une source externe : `\r\n`/`\r` → `\n`, caractères de
 * contrôle et bidi retirés, espaces de fin de ligne coupés (`trimEnd`, en O(n) —
 * une regexp ancrée en fin de ligne comme `/[ \t]+$/` dégénère en O(n²) sur une
 * ligne à très nombreux espaces suivis d'un caractère non blanc, le moteur
 * rejouant le backtracking depuis chaque position de départ), séquences de 3
 * sauts de ligne ou plus réduites à une seule ligne vide, puis troncature à
 * `max` caractères sur une frontière de mot (jamais au milieu d'un mot).
 */
export function cleanText(input: string, max: number): string {
  const withUnixNewlines = input.replace(/\r\n/g, '\n').replace(/\r/g, '\n');
  const withoutControlChars = stripControlChars(withUnixNewlines, { keepNewlines: true });
  const withoutTrailingSpaces = withoutControlChars
    .split('\n')
    .map((line) => line.trimEnd())
    .join('\n');
  const withoutExtraBlankLines = withoutTrailingSpaces.replace(/\n{3,}/g, '\n\n');
  const trimmed = withoutExtraBlankLines.trim();
  return trimmed.length <= max ? trimmed : truncateAtWordBoundary(trimmed, max);
}

/**
 * Mentions de genre parasites à retirer d'une clé de normalisation :
 * « h/f », « (h/f) », « f/h », « h/f/x », « (f/h/x) », « h-f »… (accents déjà
 * retirés et texte déjà en minuscules au moment de l'appel). Encadrée par des
 * lookarounds `(?<![a-z0-9])…(?![a-z0-9])` : sans eux, la seule alternance
 * « f/h » matcherait à tort à l'intérieur de « chef/hôtesse » (le « f » de
 * « chef » collé au « h » de « hôtesse »). Les lookarounds garantissent que
 * les lettres isolées « h »/« f »/« x » ne touchent aucune autre lettre ou
 * chiffre du texte environnant.
 */
const GENDER_MENTION_PATTERN =
  /(?<![a-z0-9])\(?\s*(h\s*[/-]\s*f(?:\s*[/-]\s*x)?|f\s*[/-]\s*h(?:\s*[/-]\s*x)?)\s*\)?(?![a-z0-9])/g;

/**
 * Normalise une chaîne pour en faire une clé de comparaison stable : forme NFD
 * sans diacritiques, minuscules, mentions « h/f » retirées, ponctuation
 * remplacée par des espaces, espaces multiples réduits à un seul. Utilisée par
 * l'empreinte de déduplication et par la déduplication des compétences.
 */
export function normalizeForKey(input: string): string {
  const withoutDiacritics = input.normalize('NFD').replace(/[̀-ͯ]/g, '');
  const lowered = withoutDiacritics.toLowerCase();
  const withoutGenderMentions = lowered.replace(GENDER_MENTION_PATTERN, ' ');
  const withoutPunctuation = withoutGenderMentions.replace(/[^a-z0-9]+/g, ' ');
  return withoutPunctuation.trim().replace(/\s+/g, ' ');
}

/**
 * Particules françaises toujours en minuscules dans un nom de lieu composé
 * (« Aix-en-Provence », « Saint-Julien-en-Born »), sauf en tout premier mot.
 * Les formes élidées (« d' », « l' ») sont incluses sans l'apostrophe : le
 * motif de mise en forme ne capture que des suites de lettres, l'apostrophe
 * n'en fait jamais partie.
 */
const LOWERCASE_PARTICLES = new Set([
  'de',
  'du',
  'des',
  'la',
  'le',
  'les',
  'sur',
  'sous',
  'en',
  'et',
  'aux',
  'd',
  'l',
]);

/**
 * Met en majuscule la première lettre de chaque mot (suites de lettres), sans
 * toucher chiffres ni ponctuation ; les particules (« en », « de »…) restent
 * en minuscules sauf en première position.
 */
function titleCaseWords(value: string): string {
  let isFirstWord = true;
  return value.replace(/[A-Za-zÀ-ÖØ-öø-ÿ]+/g, (word) => {
    const lower = word.toLowerCase();
    const keepLowercase = !isFirstWord && LOWERCASE_PARTICLES.has(lower);
    isFirstWord = false;
    return keepLowercase ? lower : word.charAt(0).toUpperCase() + word.slice(1).toLowerCase();
  });
}

/**
 * Nettoie un libellé de lieu France Travail (« 57 - METZ » → « Metz (57) »,
 * « 75 - PARIS 01 » → « Paris 01 (75) », « 13 - AIX EN PROVENCE » →
 * « Aix en Provence (13) »). Sans code préfixé (« METZ »), met simplement le
 * nom en forme de titre.
 */
export function cleanLocationLabel(input: string | null | undefined): string | null {
  if (!input) return null;
  const trimmed = input.trim();
  if (!trimmed) return null;
  const match = /^([0-9][0-9A-Za-z]{0,2})\s*-\s*(.+)$/.exec(trimmed);
  if (!match) return titleCaseWords(trimmed);
  const code = (match[1] ?? '').toUpperCase();
  const name = titleCaseWords(match[2] ?? '');
  return `${name} (${code})`;
}
