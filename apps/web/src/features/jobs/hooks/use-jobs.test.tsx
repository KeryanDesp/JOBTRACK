import type { JobDetailDto, JobListResponseDto, JobSearchQuery, JobSummaryDto } from '@jobtrack/shared';
import { jobSearchQuerySchema } from '@jobtrack/shared';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, renderHook, waitFor } from '@testing-library/react';
import type { ReactNode } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { jobKeys } from '../lib/query-keys';
import { useCommuneSearch, useJob, useJobSearch, useJobsCapabilities, useSavedJobs, useSaveJob, type RefreshRef } from './use-jobs';

const saveJob = vi.hoisted(() => vi.fn());
const unsaveJob = vi.hoisted(() => vi.fn());
const fetchJob = vi.hoisted(() => vi.fn());
const fetchJobsCapabilities = vi.hoisted(() => vi.fn());
const fetchSavedJobs = vi.hoisted(() => vi.fn());
const searchCommunes = vi.hoisted(() => vi.fn());
const searchJobs = vi.hoisted(() => vi.fn());

vi.mock('@/services/api/jobs', () => ({
  saveJob,
  unsaveJob,
  fetchJob,
  fetchJobsCapabilities,
  fetchSavedJobs,
  searchCommunes,
  searchJobs,
}));

afterEach(() => {
  saveJob.mockReset();
  unsaveJob.mockReset();
  fetchJob.mockReset();
  fetchJobsCapabilities.mockReset();
  fetchSavedJobs.mockReset();
  searchCommunes.mockReset();
  searchJobs.mockReset();
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

function makeClient(): QueryClient {
  return new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
}

function wrapperFor(client: QueryClient) {
  return ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={client}>{children}</QueryClientProvider>
  );
}

function renderUseSaveJob(client: QueryClient) {
  return renderHook(() => useSaveJob(), { wrapper: wrapperFor(client) });
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

  it('deux bascules rapprochees sur la meme offre se terminent dans le bon etat final', async () => {
    saveJob.mockResolvedValue(undefined);
    unsaveJob.mockResolvedValue(undefined);
    const client = makeClient();
    client.setQueryData(jobKeys.detail('job-1'), makeJobDetail({ saved: false }));

    const { result } = renderUseSaveJob(client);
    act(() => {
      result.current.mutate({ id: 'job-1', saved: true });
      result.current.mutate({ id: 'job-1', saved: false });
    });

    await waitFor(() => {
      expect(client.getQueryData<JobDetailDto>(jobKeys.detail('job-1'))?.saved).toBe(false);
    });
    // La portee (`scope.id`) serialise les deux mutations : chacune s'execute
    // bien une seule fois, la seconde ne remplace jamais la premiere, elle la
    // suit.
    expect(saveJob).toHaveBeenCalledTimes(1);
    expect(unsaveJob).toHaveBeenCalledTimes(1);
  });
});

describe('useJobsCapabilities', () => {
  it('renvoie les capacites annoncees par le serveur', async () => {
    fetchJobsCapabilities.mockResolvedValue({ sources: { franceTravail: true } });
    const client = makeClient();

    const { result } = renderHook(() => useJobsCapabilities(), { wrapper: wrapperFor(client) });

    await waitFor(() => expect(result.current.data).toEqual({ sources: { franceTravail: true } }));
  });
});

describe('useJob', () => {
  it('renvoie le detail de l_offre demandee', async () => {
    const detail = makeJobDetail({ id: 'job-1' });
    fetchJob.mockResolvedValue(detail);
    const client = makeClient();

    const { result } = renderHook(() => useJob('job-1'), { wrapper: wrapperFor(client) });

    await waitFor(() => expect(result.current.data).toEqual(detail));
    expect(fetchJob).toHaveBeenCalledWith('job-1');
  });
});

describe('useSavedJobs', () => {
  it('renvoie la liste des offres sauvegardees', async () => {
    const saved = [makeJobSummary({ id: 'job-1', saved: true })];
    fetchSavedJobs.mockResolvedValue(saved);
    const client = makeClient();

    const { result } = renderHook(() => useSavedJobs(), { wrapper: wrapperFor(client) });

    await waitFor(() => expect(result.current.data).toEqual(saved));
  });
});

describe('useJobSearch', () => {
  it('garde les resultats precedents affiches pendant le chargement de la recherche suivante', async () => {
    const listA = makeList([makeJobSummary({ id: 'job-1' })]);
    const listB = makeList([makeJobSummary({ id: 'job-2' })]);
    let resolveB: ((value: JobListResponseDto) => void) | undefined;

    searchJobs.mockImplementation((query: JobSearchQuery) => {
      if (query.q === 'a') return Promise.resolve(listA);
      return new Promise<JobListResponseDto>((resolve) => {
        resolveB = resolve;
      });
    });

    const client = makeClient();
    const { result, rerender } = renderHook(({ query }: { query: JobSearchQuery }) => useJobSearch(query), {
      wrapper: wrapperFor(client),
      initialProps: { query: jobSearchQuerySchema.parse({ q: 'a' }) },
    });

    await waitFor(() => expect(result.current.data).toEqual(listA));

    rerender({ query: jobSearchQuerySchema.parse({ q: 'b' }) });

    // Pendant le chargement de la recherche "b", les donnees de "a" restent
    // affichees (`placeholderData: keepPreviousData`) plutot qu'un ecran vide.
    expect(result.current.data).toEqual(listA);
    expect(result.current.isPlaceholderData).toBe(true);

    act(() => resolveB?.(listB));

    await waitFor(() => expect(result.current.data).toEqual(listB));
    expect(result.current.isPlaceholderData).toBe(false);
  });

  it('envoie refresh:true uniquement lors du refetch explicite via refreshRef, jamais au changement de filtre suivant', async () => {
    searchJobs.mockResolvedValue(makeList([]));
    const client = makeClient();
    const refreshRef: RefreshRef = { current: false };

    const { result, rerender } = renderHook(({ query }: { query: JobSearchQuery }) => useJobSearch(query, { refreshRef }), {
      wrapper: wrapperFor(client),
      initialProps: { query: jobSearchQuerySchema.parse({ q: 'a' }) },
    });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(searchJobs).toHaveBeenLastCalledWith(expect.objectContaining({ q: 'a', refresh: false }));

    // « Actualiser » : posé juste avant `refetch()`, comme le fait `jobs-page.tsx`.
    refreshRef.current = true;
    await act(async () => {
      await result.current.refetch();
    });
    expect(searchJobs).toHaveBeenLastCalledWith(expect.objectContaining({ q: 'a', refresh: true }));
    // Consommé : la ref ne reste pas armée pour la requête suivante.
    expect(refreshRef.current).toBe(false);

    // Un changement de filtre (nouvelle clé de cache) juste après ne doit jamais
    // hériter du `refresh: true` de l'actualisation précédente.
    rerender({ query: jobSearchQuerySchema.parse({ q: 'b' }) });
    await waitFor(() => expect(searchJobs).toHaveBeenLastCalledWith(expect.objectContaining({ q: 'b', refresh: false })));
  });
});

describe('useCommuneSearch', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  // Chaque test part d'une valeur vide puis passe a la valeur testee : c'est
  // le changement (comme la frappe au clavier dans `CommunePicker`) qui doit
  // etre anti-rebondi, pas seulement une valeur deja presente au montage.
  function renderCommuneSearch(client: QueryClient, initialQ = '') {
    return renderHook(({ q }: { q: string }) => useCommuneSearch(q), {
      wrapper: wrapperFor(client),
      initialProps: { q: initialQ },
    });
  }

  it('n_appelle pas searchCommunes avant le delai de 250 ms', () => {
    searchCommunes.mockResolvedValue([]);
    const client = makeClient();

    const { rerender } = renderCommuneSearch(client);
    rerender({ q: 'metz' });
    void act(() => vi.advanceTimersByTime(100));

    expect(searchCommunes).not.toHaveBeenCalled();
  });

  it('n_appelle jamais searchCommunes pour un seul caractere', () => {
    searchCommunes.mockResolvedValue([]);
    const client = makeClient();

    const { rerender } = renderCommuneSearch(client);
    rerender({ q: 'm' });
    void act(() => vi.advanceTimersByTime(250));

    expect(searchCommunes).not.toHaveBeenCalled();
  });

  it('interroge searchCommunes avec la valeur anti-rebondie une fois le delai ecoule', async () => {
    searchCommunes.mockResolvedValue([]);
    const client = makeClient();

    const { rerender } = renderCommuneSearch(client);
    rerender({ q: 'metz' });
    void act(() => vi.advanceTimersByTime(250));
    // Laisse la microtask du declenchement de la requete s'executer sous horloge simulee.
    await act(async () => {
      await Promise.resolve();
    });

    expect(searchCommunes).toHaveBeenCalledWith('metz');
    expect(client.getQueryCache().findAll({ queryKey: jobKeys.communes('metz') })).toHaveLength(1);
  });
});
