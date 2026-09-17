/**
 * Clés de requête TanStack Query du score de correspondance, séparées de
 * `jobKeys` (`features/jobs/lib/query-keys.ts`) : `matchKeys.detail(id)` porte
 * le score détaillé (`GET /jobs/:id/match`), une ressource distincte du détail
 * de l'offre elle-même (`jobKeys.detail(id)`), avec son propre cycle de vie
 * (invalidée par `useRetryJobAnalysis`, mise à jour par `useAnalyzeJobs`).
 */
export const matchKeys = {
  all: ['jobs', 'match'] as const,
  detail: (id: string) => ['jobs', 'match', id] as const,
};
