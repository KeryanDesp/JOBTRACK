import { Font } from '@react-pdf/renderer';

let registered = false;

/**
 * `@react-pdf/renderer` ne coupe jamais un « mot » dépourvu d'espace (une URL,
 * par exemple) : sans ce réglage, une URL plus large que la page dépasse dans
 * la marge au lieu de repasser à la ligne. Renvoyer les caractères un par un
 * donne au moteur de mise en page un point de coupe après chacun, sans jamais
 * insérer de trait d'union visible — un mot normal n'en est pas affecté, le
 * moteur ne coupe que là où la ligne serait sinon trop longue pour la largeur
 * disponible.
 *
 * Appelée par les deux modules `template.pdf.tsx` (Classique et Moderne),
 * seuls points d'entrée de `@react-pdf/renderer` : le drapeau `registered`
 * évite un second appel à `Font.registerHyphenationCallback` si les deux
 * modules sont chargés dans le même document (l'API est globale, pas par
 * document).
 */
export function registerPdfHyphenation(): void {
  if (registered) return;
  registered = true;
  Font.registerHyphenationCallback((word) => Array.from(word));
}
