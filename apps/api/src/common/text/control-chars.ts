import { sanitizeText } from '@jobtrack/shared';

/**
 * Retrait des caractères de contrôle et des séquences bidi d'un texte affiché tel quel.
 *
 * L'implémentation vit désormais dans le contrat partagé (`sanitizeText`, `applications.ts`),
 * seule source de la règle : contrôles C0 **et C1**, DEL, caractères de largeur nulle
 * (U+200B-U+200F), séparateurs de ligne/paragraphe, marques, embarquements et isolats
 * bidirectionnels (U+2028-U+202E, U+2060-U+2064, U+2066-U+2069), BOM (U+FEFF) ; `\r\n`/`\r`
 * ramenés à `\n` ; tabulation remplacée par une espace (jamais retirée : elle recollerait deux
 * mots) ; saut de ligne conservé sur demande ; espaces de bordure coupés.
 *
 * Cette enveloppe garde la signature historique (`keepNewlines`) pour les modules qui l'appellent
 * déjà (import de CV, offres France Travail, sorties IA des CV adaptés et des lettres). Elle
 * existe surtout pour qu'un même texte soit nettoyé exactement de la même façon des deux côtés
 * de la frontière web/API — le contrat nettoyait strictement plus que ce helper, ce qui laissait
 * passer un C1 ou un caractère de largeur nulle par les chemins qui ne passent pas par lui.
 */

export interface StripControlCharsOptions {
  /** Conserve le saut de ligne (0x0A) au lieu de le retirer. Faux par défaut. */
  keepNewlines?: boolean;
}

export function stripControlChars(value: string, options: StripControlCharsOptions = {}): string {
  return sanitizeText(value, { multiline: options.keepNewlines ?? false });
}
