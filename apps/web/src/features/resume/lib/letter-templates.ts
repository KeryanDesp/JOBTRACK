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
