import type { CoverLetterContent } from '@jobtrack/shared';
import type { ComponentType } from 'react';

/**
 * Données affichées par les jumeaux `templates/letter/{letter.preview,letter.pdf}.tsx`
 * en plus du contenu édité (`CoverLetterContent`, spec §4) : l'identité et
 * l'entreprise ne font pas partie de ce contenu (document autoporteur limité
 * au texte de la lettre), elles viennent respectivement du CV de base
 * (`useBaseResume`) et de l'offre (`useJob`) — assemblées une fois par
 * `cover-letter-page.tsx` puis transmises telles quelles aux deux jumeaux,
 * qui ne recalculent rien.
 */
export interface LetterDocumentProps {
  content: CoverLetterContent;
  /** « Prénom Nom » depuis l'identité du CV de base. */
  senderName: string;
  /** Ville de l'identité du CV de base, `null` si absente. */
  senderCity: string | null;
  /** Entreprise de l'offre liée, `null` si absente/supprimée. */
  company: string | null;
  /** Ligne de date déjà formatée (voir `formatLetterDateLine`), ex. « Metz, le 17 septembre 2026 ». */
  dateLine: string;
}

export interface LetterPdfModule {
  Pdf: ComponentType<LetterDocumentProps>;
}

/**
 * Import paresseux du module PDF (`letter.pdf.tsx`) : comme `templates.ts`
 * pour le CV, c'est la seule voie d'accès à `@react-pdf/renderer` pour la
 * lettre — ni ce fichier ni `letter.preview.tsx` n'importent la bibliothèque
 * au niveau module, pour qu'elle reste hors du bundle initial (spec §7).
 */
export function loadLetterPdf(): Promise<LetterPdfModule> {
  return import('../templates/letter/letter.pdf');
}

/**
 * Ligne d'en-tête « Ville, le 17 septembre 2026 » (spec §2, tâche 8) : sans
 * ville connue sur l'identité, seule la date reste affichée plutôt qu'une
 * virgule orpheline. `date` par défaut à aujourd'hui (paramètre pour les tests).
 */
export function formatLetterDateLine(city: string | null | undefined, date: Date = new Date()): string {
  const formatted = new Intl.DateTimeFormat('fr-FR', { day: 'numeric', month: 'long', year: 'numeric' }).format(date);
  return city && city.trim() !== '' ? `${city}, le ${formatted}` : `Le ${formatted}`;
}

/** Marques combinantes (accents) après `normalize('NFD')` — propriété Unicode `Mark`, pas une plage de points de code écrite en dur (risque d'insérer des caractères combinants illisibles dans le fichier source). */
const DIACRITIC_MARK_PATTERN = /\p{Mark}/gu;

/** Casse, accents et espaces de bord ignorés — deux libellés « identiques à l'œil » (ex. « Piloto Software » / « piloto software ») ne doivent pas être détectés comme différents. */
function normalizeOrganizationLabel(value: string): string {
  return value
    .trim()
    .toLocaleLowerCase('fr-FR')
    .normalize('NFD')
    .replace(DIACRITIC_MARK_PATTERN, '');
}

/**
 * Vrai quand `recipient` et `company` désignent la même structure (revue
 * tâche 8 fixup) : le bloc destinataire des jumeaux HTML/PDF de la lettre
 * (`templates/letter/{letter.preview,letter.pdf}.tsx`) affichait les deux
 * champs sans condition, dupliquant la ligne quand l'offre et le destinataire
 * saisi désignent la même entreprise (ex. « Piloto Software » dans les deux).
 */
export function sameOrganizationLabel(recipient: string | null, company: string | null): boolean {
  if (recipient === null || company === null) return false;
  return normalizeOrganizationLabel(recipient) === normalizeOrganizationLabel(company);
}
