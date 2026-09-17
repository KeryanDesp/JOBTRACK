import type { MatchBand, MatchPriority, Prisma } from '@prisma/client';
import { z } from 'zod';
import type { MatchScoreSummaryDto } from '@jobtrack/shared';

/**
 * Lecture d'un score de correspondance déjà calculé (`MatchScore`) vers le résumé exposé par
 * les DTO (`JobSummaryDto.match`, `ApplicationDto.job.match`). Extrait de `jobs.service.ts` :
 * deux services le lisent (offres et candidatures), et aucun des deux n'a à importer l'autre
 * — seul `MatchService` (module `matching`) écrit ces lignes, une simple consultation ne
 * recalcule jamais de score.
 */

/** Reflet minimal de `MatchScore.factors` (Json) utile à la liste : seule l'explication du
 * classement est nécessaire ici (`MatchScoreSummaryDto`), jamais le détail par facteur — validée
 * pour ne jamais faire confiance aveuglément à une colonne `Json` (revue sécurité). */
const storedMatchExplanationSchema = z.object({
  explanation: z.object({ top: z.array(z.string()), weak: z.array(z.string()) }),
});

/** Champs de `MatchScore` nécessaires à `toMatchSummary` ci-dessous — un sous-ensemble minimal
 * plutôt que le type Prisma complet, pour que les points d'appel (tri normal, tri par score,
 * cartes de candidature) puissent construire cette valeur à partir de sélections différentes. */
export interface StoredMatchScoreRow {
  jobId: string;
  score: number | null;
  band: MatchBand | null;
  priority: MatchPriority | null;
  factors: Prisma.JsonValue;
}

/** Traduit une ligne `MatchScore` (ou son absence) en `MatchScoreSummaryDto` (spec §6) :
 * l'explication du classement est relue depuis `factors` (colonne `Json`, jamais écrite que par
 * `MatchService`) et validée — un contenu inattendu retombe sur `null` plutôt que de faire
 * échouer toute la liste (même précaution que `MatchService.fromStoredPayload`, dupliquée ici :
 * les lectures passent par Prisma directement, jamais par `MatchService`, pour ne jamais
 * recalculer de score sur une simple lecture). */
export function toMatchSummary(row: StoredMatchScoreRow | undefined): MatchScoreSummaryDto | null {
  if (!row) return null;
  const parsed = storedMatchExplanationSchema.safeParse(row.factors);
  if (!parsed.success) return null;
  return { score: row.score, band: row.band, priority: row.priority, explanation: parsed.data.explanation };
}
