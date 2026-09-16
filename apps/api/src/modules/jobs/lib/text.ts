/**
 * Nettoyage de texte pour les offres France Travail : caractères de contrôle et
 * séquences bidi retirés, sauts de ligne normalisés, troncature à une longueur
 * maximale sur une frontière de mot. Une variante existe déjà dans le module
 * `cv-import` (`stripControlChars`, pour un nom de fichier sur une seule ligne),
 * mais elle n'est pas exportée et ne préserve pas les sauts de ligne — nécessaires
 * ici pour une description multi-paragraphes. Réimplémentée localement plutôt que
 * d'élargir la surface de `cv-import` pour cette tâche.
 */

/**
 * Contrôles de direction de texte (« bidi override », U+202A-U+202E et
 * U+2066-U+2069) : jamais légitimes dans un texte affiché tel quel.
 */
function isBidiOverride(codePoint: number): boolean {
  return (codePoint >= 0x202a && codePoint <= 0x202e) || (codePoint >= 0x2066 && codePoint <= 0x2069);
}

/**
 * Caractères de contrôle ASCII (0x00-0x1F, 0x7F), à l'exception du saut de
 * ligne (0x0A) déjà normalisé en amont et volontairement conservé.
 */
function isAsciiControl(codePoint: number): boolean {
  return (codePoint < 0x20 && codePoint !== 0x0a) || codePoint === 0x7f;
}

/** Écrit caractère par caractère plutôt qu'avec une classe de contrôle en regex (bannie par `no-control-regex`). */
function stripControlChars(value: string): string {
  let result = '';
  for (const char of value) {
    const code = char.codePointAt(0) ?? 0;
    if (!isAsciiControl(code) && !isBidiOverride(code)) result += char;
  }
  return result;
}

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
 * contrôle et bidi retirés, espaces de fin de ligne coupés, séquences de 3 sauts
 * de ligne ou plus réduites à une seule ligne vide, puis troncature à `max`
 * caractères sur une frontière de mot (jamais au milieu d'un mot).
 */
export function cleanText(input: string, max: number): string {
  const withUnixNewlines = input.replace(/\r\n/g, '\n').replace(/\r/g, '\n');
  const withoutControlChars = stripControlChars(withUnixNewlines);
  const withoutTrailingSpaces = withoutControlChars
    .split('\n')
    .map((line) => line.replace(/[ \t]+$/g, ''))
    .join('\n');
  const withoutExtraBlankLines = withoutTrailingSpaces.replace(/\n{3,}/g, '\n\n');
  const trimmed = withoutExtraBlankLines.trim();
  return trimmed.length <= max ? trimmed : truncateAtWordBoundary(trimmed, max);
}

/**
 * Mentions de genre parasites à retirer d'une clé de normalisation :
 * « h/f », « (h/f) », « f/h », « h/f/x », « (f/h/x) », « h-f »… (accents déjà
 * retirés et texte déjà en minuscules au moment de l'appel).
 */
const GENDER_MENTION_PATTERN = /\(?\s*(h\s*[/-]\s*f(?:\s*[/-]\s*x)?|f\s*[/-]\s*h(?:\s*[/-]\s*x)?)\s*\)?/g;

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

/** Met en majuscule la première lettre de chaque mot (suites de lettres), sans toucher chiffres ni ponctuation. */
function titleCaseWords(value: string): string {
  return value.replace(
    /[A-Za-zÀ-ÖØ-öø-ÿ]+/g,
    (word) => word.charAt(0).toUpperCase() + word.slice(1).toLowerCase(),
  );
}

/**
 * Nettoie un libellé de lieu France Travail (« 57 - METZ » → « Metz (57) »,
 * « 75 - PARIS 01 » → « Paris 01 (75) »). Sans code préfixé (« METZ »), met
 * simplement le nom en forme de titre.
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
