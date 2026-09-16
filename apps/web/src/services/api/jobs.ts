import type { CommuneDto, JobDetailDto, JobListResponseDto, JobSearchQuery, JobSummaryDto, JobsCapabilitiesDto } from '@jobtrack/shared';
import { toJobSearchParams } from '@jobtrack/shared';
import { apiRequest } from './client';

export const fetchJobsCapabilities = () => apiRequest<JobsCapabilitiesDto>('/jobs/capabilities');

/**
 * Recherche paginée : `toJobSearchParams` (contrat partagé) construit la
 * chaîne de requête avec les clés courtes de l'URL et omet déjà les valeurs
 * par défaut — pas de table de correspondance à dupliquer ici. Sans aucun
 * paramètre non défaut, la chaîne est vide et l'appel se fait sans `?`.
 */
export function searchJobs(query: JobSearchQuery): Promise<JobListResponseDto> {
  const search = toJobSearchParams(query).toString();
  return apiRequest<JobListResponseDto>(search ? `/jobs?${search}` : '/jobs');
}

export const fetchJob = (id: string) => apiRequest<JobDetailDto>(`/jobs/${id}`);

export const fetchSavedJobs = () => apiRequest<JobSummaryDto[]>('/jobs/saved');

// 204 sans corps dans les deux cas : `apiRequest` renvoie `undefined` pour ce statut.
export const saveJob = (id: string) => apiRequest<void>(`/jobs/${id}/save`, { method: 'POST' });

export const unsaveJob = (id: string) => apiRequest<void>(`/jobs/${id}/save`, { method: 'DELETE' });

export function searchCommunes(q: string): Promise<CommuneDto[]> {
  return apiRequest<CommuneDto[]>(`/jobs/communes?q=${encodeURIComponent(q)}`);
}
