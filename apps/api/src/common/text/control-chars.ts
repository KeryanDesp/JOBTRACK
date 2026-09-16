/**
 * Retrait des caractères de contrôle ASCII (0x00-0x1F, 0x7F) et des contrôles
 * de direction de texte (« bidi override », U+202A-U+202E et U+2066-U+2069 —
 * jamais légitimes dans un texte affiché tel quel, détournés pour déguiser un
 * nom de fichier ou un contenu). Écrit caractère par caractère plutôt qu'avec
 * une classe de contrôle en regex (bannie par `no-control-regex`, et de toute
 * façon moins lisible qu'une comparaison de code point).
 *
 * Utilisé à la fois par la validation des CV (nom de fichier, une seule
 * ligne : `keepNewlines` par défaut à `false`) et par le nettoyage des
 * descriptions d'offres France Travail (texte multi-paragraphes :
 * `keepNewlines: true`).
 */

export interface StripControlCharsOptions {
  /** Conserve le saut de ligne (0x0A) au lieu de le retirer. Faux par défaut. */
  keepNewlines?: boolean;
}

const TAB_CODE_POINT = 0x09;
const NEWLINE_CODE_POINT = 0x0a;
const DELETE_CODE_POINT = 0x7f;

function isBidiOverride(codePoint: number): boolean {
  return (codePoint >= 0x202a && codePoint <= 0x202e) || (codePoint >= 0x2066 && codePoint <= 0x2069);
}

export function stripControlChars(value: string, options: StripControlCharsOptions = {}): string {
  const { keepNewlines = false } = options;
  let result = '';
  for (const char of value) {
    const code = char.codePointAt(0) ?? 0;
    if (isBidiOverride(code)) continue;
    // Une tabulation déforme un affichage sur une seule ligne : remplacée par un
    // espace plutôt que retirée, pour ne jamais recoller deux mots involontairement.
    if (code === TAB_CODE_POINT) {
      result += ' ';
      continue;
    }
    if (keepNewlines && code === NEWLINE_CODE_POINT) {
      result += char;
      continue;
    }
    const isAsciiControl = code < 0x20 || code === DELETE_CODE_POINT;
    if (!isAsciiControl) result += char;
  }
  return result;
}
