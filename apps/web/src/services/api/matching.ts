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

// `apiRequest` ne traite que le 204 comme « sans corps » (voir `client.ts`) : un
// 202 est donc décodé en JSON comme toute autre réponse (`{}` ou un corps minimal
// selon l'implémentation serveur), jamais supposé vide ici.
export const retryJobAnalysis = (id: string) => apiRequest<void>(`/jobs/${id}/analyses/retry`, { method: 'POST' });
