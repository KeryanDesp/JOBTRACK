import type { AnalyzeJobsResponseDto, MatchScoreDto } from '@jobtrack/shared';
import { apiRequest } from './client';

/** `POST /jobs/analyses` : analyse les offres manquantes puis renvoie l'état par offre (spec §6). */
export function analyzeJobs(jobIds: string[]): Promise<AnalyzeJobsResponseDto> {
  return apiRequest<AnalyzeJobsResponseDto>('/jobs/analyses', {
    method: 'POST',
    body: JSON.stringify({ jobIds }),
  });
}

/** `GET /jobs/:id/match` : score détaillé (facteurs, explications, statut d'analyse). */
export const fetchJobMatch = (id: string) => apiRequest<MatchScoreDto>(`/jobs/${id}/match`);

// `apiRequest` (voir `client.ts`) est désormais agnostique au corps : un 202
// sans corps résout à `undefined` comme un 204, sans dépendre du statut exact
// choisi par l'implémentation serveur.
export function retryJobAnalysis(id: string): Promise<void> {
  return apiRequest<void>(`/jobs/${id}/analyses/retry`, { method: 'POST' });
}
