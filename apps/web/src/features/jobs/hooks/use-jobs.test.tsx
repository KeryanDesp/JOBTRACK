import type { JobDetailDto, JobListResponseDto, JobSummaryDto } from '@jobtrack/shared';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, renderHook, waitFor } from '@testing-library/react';
import type { ReactNode } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { jobKeys } from '../lib/query-keys';
import { useSaveJob } from './use-jobs';

const saveJob = vi.hoisted(() => vi.fn());
const unsaveJob = vi.hoisted(() => vi.fn());

// Seuls `saveJob`/`unsaveJob` sont exercés par ces tests ; les autres exports
// du module sont mockés à vide pour que l'import ne casse pas, mais ne sont
// jamais appelés ici (pas de `useQuery` monté dans ces tests).
vi.mock('@/services/api/jobs', () => ({
  saveJob,
  unsaveJob,
  fetchJob: vi.fn(),
  fetchJobsCapabilities: vi.fn(),
  fetchSavedJobs: vi.fn(),
  searchCommunes: vi.fn(),
  searchJobs: vi.fn(),
}));

afterEach(() => {
  saveJob.mockReset();
  unsaveJob.mockReset();
});

function makeJobSummary(overrides: Partial<JobSummaryDto> = {}): JobSummaryDto {
  return {
    id: 'job-1',
    title: 'Développeur',
    company: 'Acme',
    companyLogoUrl: null,
    locationLabel: 'Metz (57)',
    departmentCode: '57',
    contractType: 'CDI',
    contractLabel: 'CDI',
    remoteMode: null,
    remoteModeInferred: false,
    experienceLevel: null,
    salaryMinAnnual: null,
    salaryMaxAnnual: null,
    salaryLabel: null,
    currency: 'EUR',
    publishedAt: '2026-09-15T00:00:00.000Z',
    expiredAt: null,
    skills: [],
    sources: ['FRANCE_TRAVAIL'],
    saved: false,
    ...overrides,
  };
}

function makeJobDetail(overrides: Partial<JobDetailDto> = {}): JobDetailDto {
  const summary = makeJobSummary();
  return {
    ...summary,
    description: 'Description.',
    companyDescription: null,
    companyUrl: null,
    communeCode: '57463',
    postalCode: '57000',
    latitude: null,
    longitude: null,
    contractNature: null,
    experienceLabel: null,
    experienceRequired: null,
    workingTimeLabel: null,
    isFullTime: null,
    isApprenticeship: false,
    positionsCount: null,
    accessibleTh: null,
    sectorLabel: null,
    romeCode: null,
    romeLabel: null,
    qualificationLabel: null,
    sourceUpdatedAt: null,
    lastSeenAt: '2026-09-16T00:00:00.000Z',
    skills: [],
    sources: [],
    requirements: [],
    ...overrides,
  };
}

function makeList(items: JobSummaryDto[]): JobListResponseDto {
  return { items, total: items.length, page: 1, pageSize: 20, sync: { status: 'ok', syncedAt: null, message: null } };
}

function renderUseSaveJob(client: QueryClient) {
  const wrapper = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={client}>{children}</QueryClientProvider>
  );
  return renderHook(() => useSaveJob(), { wrapper });
}

function makeClient(): QueryClient {
  return new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
}

describe('useSaveJob', () => {
  it('met a jour le detail en cache de facon optimiste avant la reponse serveur', async () => {
    saveJob.mockReturnValue(new Promise<void>(() => {}));
    const client = makeClient();
    client.setQueryData(jobKeys.detail('job-1'), makeJobDetail({ saved: false }));

    const { result } = renderUseSaveJob(client);
    act(() => result.current.mutate({ id: 'job-1', saved: true }));

    await waitFor(() => {
      expect(client.getQueryData<JobDetailDto>(jobKeys.detail('job-1'))?.saved).toBe(true);
    });
  });

  it('met a jour toutes les listes de recherche en cache dont le prefixe est jobs/search', async () => {
    saveJob.mockReturnValue(new Promise<void>(() => {}));
    const client = makeClient();
    // `setQueriesData`/`cancelQueries` de `useSaveJob` filtrent uniquement sur le
    // prefixe `['jobs', 'search']` : peu importe la forme exacte du troisieme
    // element de la cle ici, seul le prefixe doit correspondre a une vraie clé
    // produite par `jobKeys.search(...)`.
    const listQueryKey = ['jobs', 'search', { q: '' }] as const;
    client.setQueryData(listQueryKey, makeList([makeJobSummary({ id: 'job-1', saved: false })]));

    const { result } = renderUseSaveJob(client);
    act(() => result.current.mutate({ id: 'job-1', saved: true }));

    await waitFor(() => {
      const list = client.getQueryData<JobListResponseDto>(listQueryKey);
      expect(list?.items[0]?.saved).toBe(true);
    });
  });

  it('ajoute l_offre a la liste des favoris depuis le cache de recherche quand elle est sauvegardee', async () => {
    saveJob.mockReturnValue(new Promise<void>(() => {}));
    const client = makeClient();
    const listQueryKey = ['jobs', 'search', { q: '' }] as const;
    client.setQueryData(listQueryKey, makeList([makeJobSummary({ id: 'job-1', saved: false })]));
    client.setQueryData(jobKeys.saved, [] satisfies JobSummaryDto[]);

    const { result } = renderUseSaveJob(client);
    act(() => result.current.mutate({ id: 'job-1', saved: true }));

    await waitFor(() => {
      const saved = client.getQueryData<JobSummaryDto[]>(jobKeys.saved);
      expect(saved?.map((item) => item.id)).toEqual(['job-1']);
    });
  });

  it('retire l_offre de la liste des favoris de facon optimiste', async () => {
    unsaveJob.mockReturnValue(new Promise<void>(() => {}));
    const client = makeClient();
    client.setQueryData(jobKeys.saved, [makeJobSummary({ id: 'job-1', saved: true })]);

    const { result } = renderUseSaveJob(client);
    act(() => result.current.mutate({ id: 'job-1', saved: false }));

    await waitFor(() => {
      expect(client.getQueryData<JobSummaryDto[]>(jobKeys.saved)).toEqual([]);
    });
  });

  it('annule la mise a jour optimiste et restaure le detail d_origine si la requete echoue', async () => {
    saveJob.mockRejectedValue(new Error('boom'));
    const client = makeClient();
    const original = makeJobDetail({ saved: false });
    client.setQueryData(jobKeys.detail('job-1'), original);

    const { result } = renderUseSaveJob(client);
    act(() => result.current.mutate({ id: 'job-1', saved: true }));

    await waitFor(() => expect(result.current.isError).toBe(true));
    expect(client.getQueryData<JobDetailDto>(jobKeys.detail('job-1'))).toEqual(original);
  });

  it('ne plante pas quand aucune donnee n_est en cache pour l_offre concernee', async () => {
    saveJob.mockResolvedValue(undefined);
    const client = makeClient();

    const { result } = renderUseSaveJob(client);
    act(() => result.current.mutate({ id: 'job-inconnue', saved: true }));

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
  });
});
