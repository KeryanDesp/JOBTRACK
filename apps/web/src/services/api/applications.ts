import type {
  ApplicationBoardDto,
  ApplicationDetailDto,
  ApplicationListQueryInput,
  ApplicationListResponseDto,
  ApplicationStatsDto,
  CreateApplicationInput,
  MoveApplicationInput,
  UpdateApplicationInput,
} from '@jobtrack/shared';
import { applicationListQuerySchema } from '@jobtrack/shared';
import { apiRequest } from './client';

// Routes spec §6.

// Valeurs par défaut du schéma partagé (`applicationListQuerySchema.parse({})`) : toute
// valeur de `query` égale à sa valeur par défaut est omise de la chaîne de requête,
// comme `toJobSearchParams` (`@jobtrack/shared`, jobs.ts) le fait pour `searchJobs`.
const DEFAULT_LIST_QUERY = applicationListQuerySchema.parse({});

/**
 * Construit la chaîne de requête de `GET /applications` : uniquement les
 * valeurs qui diffèrent du défaut (spec §4/§6), `q` absent quand il est vide
 * ou indéfini. Les clés du contrat partagé (`tab`, `q`, `page`, `limit`, `sort`)
 * servent directement de clés d'URL — aucune table de correspondance courte
 * n'existe ici, contrairement à `jobs.ts`.
 */
function buildApplicationListSearchParams(query: ApplicationListQueryInput): URLSearchParams {
  const params = new URLSearchParams();

  if (query.tab !== undefined && query.tab !== DEFAULT_LIST_QUERY.tab) {
    params.set('tab', query.tab);
  }
  if (query.q !== undefined && query.q !== '') {
    params.set('q', query.q);
  }
  if (query.page !== undefined && query.page !== DEFAULT_LIST_QUERY.page) {
    params.set('page', String(query.page));
  }
  if (query.limit !== undefined && query.limit !== DEFAULT_LIST_QUERY.limit) {
    params.set('limit', String(query.limit));
  }
  if (query.sort !== undefined && query.sort !== DEFAULT_LIST_QUERY.sort) {
    params.set('sort', query.sort);
  }

  return params;
}

export function fetchApplications(query: ApplicationListQueryInput): Promise<ApplicationListResponseDto> {
  const search = buildApplicationListSearchParams(query).toString();
  return apiRequest<ApplicationListResponseDto>(search ? `/applications?${search}` : '/applications');
}

export const fetchApplicationStats = () => apiRequest<ApplicationStatsDto>('/applications/stats');

export const fetchApplicationBoard = () => apiRequest<ApplicationBoardDto>('/applications/board');

export const fetchApplication = (id: string) => apiRequest<ApplicationDetailDto>(`/applications/${id}`);

export function createApplication(input: CreateApplicationInput): Promise<ApplicationDetailDto> {
  return apiRequest<ApplicationDetailDto>('/applications', {
    method: 'POST',
    body: JSON.stringify(input),
  });
}

export function updateApplication(id: string, input: UpdateApplicationInput): Promise<ApplicationDetailDto> {
  return apiRequest<ApplicationDetailDto>(`/applications/${id}`, {
    method: 'PATCH',
    body: JSON.stringify(input),
  });
}

export function moveApplication(id: string, input: MoveApplicationInput): Promise<ApplicationDetailDto> {
  return apiRequest<ApplicationDetailDto>(`/applications/${id}/move`, {
    method: 'PATCH',
    body: JSON.stringify(input),
  });
}

// 204 sans corps : `apiRequest` renvoie `undefined` pour ce statut.
export const deleteApplication = (id: string) => apiRequest<void>(`/applications/${id}`, { method: 'DELETE' });
