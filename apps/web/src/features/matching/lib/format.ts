import type { MatchBand, MatchPriority, MatchScoreDto } from '@jobtrack/shared';

/**
 * Classes utilitaires sémantiques (jetons `tokens.css`, jamais de couleur en dur)
 * pour un texte/fond/bordure à la couleur d'une bande de score. `EXCELLENT` →
 * succès, `GOOD` → primaire (violet), `PARTIAL` → avertissement, `WEAK`/`null`
 * (score non évalué) → atténué (spec §5/§7).
 */
export interface BandTone {
  text: string;
  bg: string;
  border: string;
}

const BAND_TONES: Record<MatchBand, BandTone> = {
  EXCELLENT: { text: 'text-success', bg: 'bg-success/10', border: 'border-success/30' },
  GOOD: { text: 'text-primary', bg: 'bg-primary/10', border: 'border-primary/30' },
  PARTIAL: { text: 'text-warning', bg: 'bg-warning/10', border: 'border-warning/30' },
  WEAK: { text: 'text-muted-foreground', bg: 'bg-muted', border: 'border-border' },
};

const UNEVALUATED_TONE: BandTone = { text: 'text-muted-foreground', bg: 'bg-muted', border: 'border-border' };

export function bandTone(band: MatchBand | null): BandTone {
  return band === null ? UNEVALUATED_TONE : BAND_TONES[band];
}

/** « 92 » pour un score connu, tiret cadratin pour un score non évalué (`null`). */
export function formatScore(score: number | null): string {
  return score === null ? '—' : String(score);
}

/**
 * Phrase de recommandation (spec §2 : « Priorité élevée : candidature à
 * préparer cette semaine. »). `null` (score pas encore calculé, offre non
 * analysée…) renvoie une chaîne vide : à l'appelant de ne rien afficher plutôt
 * que d'imprimer une phrase creuse.
 */
export function recommendationFor(priority: MatchPriority | null): string {
  switch (priority) {
    case 'VERY_HIGH':
    case 'HIGH':
      return 'Priorité élevée : candidature à préparer cette semaine.';
    case 'GOOD':
      return 'Bonne opportunité : à étudier.';
    case 'CONSIDER':
      return 'À considérer selon vos autres options.';
    case 'LOW':
      return "Correspondance faible : privilégiez d'autres offres.";
    case null:
      return '';
  }
}

export type AnalysisStatus = MatchScoreDto['analysis']['status'];

/** Message d'état de l'analyse (spec §2/§7), affiché par `MatchPanel` selon `analysis.status`. */
export function analysisStatusMessage(status: AnalysisStatus): string {
  switch (status) {
    case 'none':
      return "Cette offre n'a pas encore été analysée.";
    case 'pending':
      return 'Analyse en cours…';
    case 'failed':
      return "L'analyse de cette offre a échoué.";
    case 'ai_not_configured':
      return "L'analyse des offres nécessite le service IA (non configuré).";
    case 'done':
      return '';
  }
}
