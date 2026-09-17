import type { AnalyzeJobsResponseDto, JobListResponseDto, JobSummaryDto, MatchScoreDto } from '@jobtrack/shared';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, renderHook, waitFor } from '@testing-library/react';
import type { ReactNode } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ApiError } from '@/services/api/client';
import { matchKeys } from '../lib/query-keys';
import { useAnalysisPolling, useAnalyzeJobs, useJobMatch, useRetryJobAnalysis } from './use-match';

const analyzeJobs = vi.hoisted(() => vi.fn());
const fetchJobMatch = vi.hoisted(() => vi.fn());
const retryJobAnalysis = vi.hoisted(() => vi.fn());

vi.mock('@/services/api/matching', () => ({
  analyzeJobs,
  fetchJobMatch,
  retryJobAnalysis,
}));

afterEach(() => {
  analyzeJobs.mockReset();
  fetchJobMatch.mockReset();
  retryJobAnalysis.mockReset();
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
    match: null,
    ...overrides,
  };
}

function makeList(items: JobSummaryDto[]): JobListResponseDto {
  return {
    items,
    total: items.length,
    page: 1,
    pageSize: 20,
    sync: { status: 'ok', syncedAt: null, message: null, analysis: { analyzed: 0, total: items.length, notConfigured: false } },
  };
}

function makeAnalyzeResponse(overrides: Partial<AnalyzeJobsResponseDto> = {}): AnalyzeJobsResponseDto {
  return {
    analyzed: 1,
    pending: 0,
    failed: 0,
    notConfigured: false,
    profileComplete: true,
    scores: {},
    ...overrides,
  };
}

function makeMatchDetail(overrides: Partial<MatchScoreDto> = {}): MatchScoreDto {
  return {
    score: null,
    band: null,
    priority: null,
    explanation: { top: [], weak: [] },
    factors: [],
    computedAt: null,
    analysis: { status: 'pending', error: null },
    profileComplete: true,
    insufficientData: false,
    ...overrides,
  };
}

function makeClient(): QueryClient {
  return new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
}

function wrapperFor(client: QueryClient) {
  return ({ children }: { children: ReactNode }) => <QueryClientProvider client={client}>{children}</QueryClientProvider>;
}

describe('useJobMatch', () => {
  it('renvoie le score detaille de l_offre demandee', async () => {
    const detail = makeMatchDetail({ score: 92, band: 'EXCELLENT', priority: 'VERY_HIGH', analysis: { status: 'done', error: null } });
    fetchJobMatch.mockResolvedValue(detail);
    const client = makeClient();

    const { result } = renderHook(() => useJobMatch('job-1'), { wrapper: wrapperFor(client) });

    await waitFor(() => expect(result.current.data).toEqual(detail));
    expect(fetchJobMatch).toHaveBeenCalledWith('job-1');
  });
});

describe('useAnalyzeJobs', () => {
  it('met a jour toutes les listes de recherche en cache avec les scores renvoyes', async () => {
    analyzeJobs.mockResolvedValue(
      makeAnalyzeResponse({
        scores: {
          'job-1': { score: 92, band: 'EXCELLENT', priority: 'VERY_HIGH', explanation: { top: [], weak: [] } },
        },
      }),
    );
    const client = makeClient();
    const listQueryKey = ['jobs', 'search', { q: '' }] as const;
    client.setQueryData(listQueryKey, makeList([makeJobSummary({ id: 'job-1', match: null })]));

    const { result } = renderHook(() => useAnalyzeJobs(), { wrapper: wrapperFor(client) });
    act(() => result.current.analyze(['job-1']));

    await waitFor(() => {
      const list = client.getQueryData<JobListResponseDto>(listQueryKey);
      expect(list?.items[0]?.match).toEqual({ score: 92, band: 'EXCELLENT', priority: 'VERY_HIGH', explanation: { top: [], weak: [] } });
    });
  });

  it('conserve le score deja en cache pour une offre absente de la reponse', async () => {
    const existingMatch = { score: 60, band: 'PARTIAL' as const, priority: 'CONSIDER' as const, explanation: { top: [], weak: [] } };
    analyzeJobs.mockResolvedValue(makeAnalyzeResponse({ scores: { 'job-2': null } }));
    const client = makeClient();
    const listQueryKey = ['jobs', 'search', { q: '' }] as const;
    client.setQueryData(listQueryKey, makeList([makeJobSummary({ id: 'job-1', match: existingMatch })]));

    const { result } = renderHook(() => useAnalyzeJobs(), { wrapper: wrapperFor(client) });
    act(() => result.current.analyze(['job-1', 'job-2']));

    await waitFor(() => expect(result.current.isAnalyzing).toBe(false));
    const list = client.getQueryData<JobListResponseDto>(listQueryKey);
    expect(list?.items[0]?.match).toEqual(existingMatch);
  });

  it('remplace par null le score d_une offre presente dans la reponse mais encore indisponible', async () => {
    const existingMatch = { score: 60, band: 'PARTIAL' as const, priority: 'CONSIDER' as const, explanation: { top: [], weak: [] } };
    analyzeJobs.mockResolvedValue(makeAnalyzeResponse({ scores: { 'job-1': null } }));
    const client = makeClient();
    const listQueryKey = ['jobs', 'search', { q: '' }] as const;
    client.setQueryData(listQueryKey, makeList([makeJobSummary({ id: 'job-1', match: existingMatch })]));

    const { result } = renderHook(() => useAnalyzeJobs(), { wrapper: wrapperFor(client) });
    act(() => result.current.analyze(['job-1']));

    await waitFor(() => expect(result.current.isAnalyzing).toBe(false));
    const list = client.getQueryData<JobListResponseDto>(listQueryKey);
    expect(list?.items[0]?.match).toBeNull();
  });

  it('invalide le score detaille en cache pour chaque offre de la reponse, sans jamais le fusionner', async () => {
    analyzeJobs.mockResolvedValue(
      makeAnalyzeResponse({
        scores: { 'job-1': { score: 92, band: 'EXCELLENT', priority: 'VERY_HIGH', explanation: { top: [], weak: [] } } },
      }),
    );
    const client = makeClient();
    client.setQueryData(matchKeys.detail('job-1'), makeMatchDetail({ analysis: { status: 'pending', error: null } }));

    const { result } = renderHook(() => useAnalyzeJobs(), { wrapper: wrapperFor(client) });
    act(() => result.current.analyze(['job-1']));

    await waitFor(() => expect(client.getQueryState(matchKeys.detail('job-1'))?.isInvalidated).toBe(true));
    // Jamais fusionne : le detail garde son statut d'analyse tant qu'aucun GET n'a ete rejoue.
    expect(client.getQueryData<MatchScoreDto>(matchKeys.detail('job-1'))?.analysis.status).toBe('pending');
  });

  it('expose l_etat notConfigured et profileComplete a partir de la derniere reponse', async () => {
    analyzeJobs.mockResolvedValue(makeAnalyzeResponse({ notConfigured: true, profileComplete: false, pending: 2 }));
    const client = makeClient();

    const { result } = renderHook(() => useAnalyzeJobs(), { wrapper: wrapperFor(client) });
    act(() => result.current.analyze(['job-1']));

    await waitFor(() => expect(result.current.pending).toBe(2));
    expect(result.current.notConfigured).toBe(true);
    expect(result.current.profileComplete).toBe(false);
  });

  it('convertit une erreur AI_NOT_CONFIGURED en etat notConfigured, sans erreur exposee', async () => {
    analyzeJobs.mockRejectedValue(new ApiError('IA non configurée.', 503, 'AI_NOT_CONFIGURED'));
    const client = makeClient();

    const { result } = renderHook(() => useAnalyzeJobs(), { wrapper: wrapperFor(client) });
    act(() => result.current.analyze(['job-1']));

    await waitFor(() => expect(result.current.isAnalyzing).toBe(false));
    expect(result.current.notConfigured).toBe(true);
    expect(result.current.pending).toBe(0);
    expect(result.current.error).toBeNull();
  });

  it('remet pending a 0 et expose l_erreur sur un 429, sans reessai', async () => {
    analyzeJobs.mockRejectedValue(new ApiError('Trop de requêtes.', 429, 'RATE_LIMITED'));
    const client = makeClient();

    const { result } = renderHook(() => useAnalyzeJobs(), { wrapper: wrapperFor(client) });
    act(() => result.current.analyze(['job-1']));

    await waitFor(() => expect(result.current.error).not.toBeNull());
    expect(result.current.pending).toBe(0);
    expect(result.current.error).toMatchObject({ status: 429 });
    expect(analyzeJobs).toHaveBeenCalledTimes(1);
  });

  it('ne laisse pas pending colle a une ancienne valeur quand l_appel suivant echoue', async () => {
    analyzeJobs.mockResolvedValueOnce(makeAnalyzeResponse({ pending: 3 }));
    const client = makeClient();
    const { result } = renderHook(() => useAnalyzeJobs(), { wrapper: wrapperFor(client) });

    act(() => result.current.analyze(['job-1']));
    await waitFor(() => expect(result.current.pending).toBe(3));

    analyzeJobs.mockRejectedValueOnce(new ApiError('Trop de requêtes.', 429, 'RATE_LIMITED'));
    act(() => result.current.analyze(['job-1']));

    await waitFor(() => expect(result.current.error).not.toBeNull());
    expect(result.current.pending).toBe(0);
  });

  it(
    'reessaie une fois apres 4 s pour une panne transitoire puis abandonne si le reessai echoue aussi',
    async () => {
      analyzeJobs.mockRejectedValue(new ApiError('Erreur serveur.', 500));
      const client = makeClient();

      const { result } = renderHook(() => useAnalyzeJobs(), { wrapper: wrapperFor(client) });
      act(() => result.current.analyze(['job-1']));

      await waitFor(() => expect(analyzeJobs).toHaveBeenCalledTimes(1));
      expect(result.current.isAnalyzing).toBe(true);

      await waitFor(() => expect(analyzeJobs).toHaveBeenCalledTimes(2), { timeout: 6_000 });
      await waitFor(() => expect(result.current.isAnalyzing).toBe(false));
      expect(result.current.error).not.toBeNull();
      expect(result.current.pending).toBe(0);
    },
    8_000,
  );
});

describe('useAnalysisPolling', () => {
  it('arrete de sonder des que la reponse porte pending a 0', async () => {
    analyzeJobs.mockResolvedValue(makeAnalyzeResponse({ pending: 0 }));
    const client = makeClient();

    const { result } = renderHook(() => useAnalysisPolling(['job-1']), { wrapper: wrapperFor(client) });

    await waitFor(() => expect(result.current.isAnalyzing).toBe(false));
    expect(result.current.pending).toBe(0);
    expect(analyzeJobs).toHaveBeenCalledTimes(1);

    // Le sondage est planifie via `setTimeout` seulement si `pending > 0` : avec
    // une reponse deja a 0, aucun second appel ne doit survenir meme apres un
    // delai largement superieur a l'intervalle de sondage (2 s).
    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(analyzeJobs).toHaveBeenCalledTimes(1);
  });

  it(
    'continue de sonder toutes les 2 s tant que pending est superieur a 0 puis s_arrete',
    async () => {
      analyzeJobs
        .mockResolvedValueOnce(makeAnalyzeResponse({ pending: 1 }))
        .mockResolvedValueOnce(makeAnalyzeResponse({ pending: 1 }))
        .mockResolvedValueOnce(makeAnalyzeResponse({ pending: 0 }));
      const client = makeClient();

      const { result } = renderHook(() => useAnalysisPolling(['job-1']), { wrapper: wrapperFor(client) });

      // Un appel de `mock.calls` est enregistre des l'invocation, avant meme
      // que sa promesse ne se resolve : on attend l'etat derive (`pending`)
      // plutot que le seul compteur d'appels, pour ne pas lire `result.current`
      // avant que le second rendu (issu du `setState` post-reponse) n'ait eu lieu.
      await waitFor(() => expect(result.current.pending).toBe(1));
      expect(analyzeJobs).toHaveBeenCalledTimes(1);

      await waitFor(() => expect(analyzeJobs).toHaveBeenCalledTimes(2), { timeout: 4_000 });
      await waitFor(() => expect(analyzeJobs).toHaveBeenCalledTimes(3), { timeout: 4_000 });
      await waitFor(() => expect(result.current.pending).toBe(0));

      // Plus aucun appel apres l'arret (pending redevenu 0), meme apres un delai
      // largement superieur a l'intervalle de sondage.
      await new Promise((resolve) => setTimeout(resolve, 2_500));
      expect(analyzeJobs).toHaveBeenCalledTimes(3);
    },
    12_000,
  );

  it(
    'arrete le sondage au demontage du composant',
    async () => {
      analyzeJobs.mockResolvedValue(makeAnalyzeResponse({ pending: 1 }));
      const client = makeClient();
      const { unmount } = renderHook(() => useAnalysisPolling(['job-1']), { wrapper: wrapperFor(client) });

      await waitFor(() => expect(analyzeJobs).toHaveBeenCalledTimes(1));

      unmount();

      await new Promise((resolve) => setTimeout(resolve, 2_500));
      expect(analyzeJobs).toHaveBeenCalledTimes(1);
    },
    6_000,
  );

  it('arrete le sondage apres un budget de 60 s meme si pending reste positif', async () => {
    vi.useFakeTimers();
    try {
      analyzeJobs.mockResolvedValue(makeAnalyzeResponse({ pending: 1 }));
      const client = makeClient();
      renderHook(() => useAnalysisPolling(['job-1']), { wrapper: wrapperFor(client) });

      await act(async () => {
        await vi.advanceTimersByTimeAsync(70_000);
      });
      const callsAt70s = analyzeJobs.mock.calls.length;
      expect(callsAt70s).toBeGreaterThan(1);

      await act(async () => {
        await vi.advanceTimersByTimeAsync(10_000);
      });
      expect(analyzeJobs.mock.calls.length).toBe(callsAt70s);
    } finally {
      vi.useRealTimers();
    }
  });

  it('ne sonde rien sans identifiant d_offre', () => {
    const client = makeClient();

    renderHook(() => useAnalysisPolling([]), { wrapper: wrapperFor(client) });

    expect(analyzeJobs).not.toHaveBeenCalled();
  });

  it('convertit une erreur AI_NOT_CONFIGURED en etat notConfigured et arrete le sondage, sans erreur exposee', async () => {
    analyzeJobs.mockRejectedValue(new ApiError('IA non configurée.', 503, 'AI_NOT_CONFIGURED'));
    const client = makeClient();

    const { result } = renderHook(() => useAnalysisPolling(['job-1']), { wrapper: wrapperFor(client) });

    await waitFor(() => expect(result.current.isAnalyzing).toBe(false));
    expect(result.current.notConfigured).toBe(true);
    expect(result.current.pending).toBe(0);
    expect(result.current.error).toBeNull();
    expect(analyzeJobs).toHaveBeenCalledTimes(1);

    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(analyzeJobs).toHaveBeenCalledTimes(1);
  });

  it('arrete le sondage sans reessai sur une erreur 429', async () => {
    analyzeJobs.mockRejectedValue(new ApiError('Trop de requêtes.', 429, 'RATE_LIMITED'));
    const client = makeClient();

    const { result } = renderHook(() => useAnalysisPolling(['job-1']), { wrapper: wrapperFor(client) });

    await waitFor(() => expect(result.current.error).not.toBeNull());
    expect(result.current.pending).toBe(0);
    expect(analyzeJobs).toHaveBeenCalledTimes(1);

    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(analyzeJobs).toHaveBeenCalledTimes(1);
  });
});

describe('useRetryJobAnalysis', () => {
  it('invalide le score detaille en cache apres une relance reussie', async () => {
    retryJobAnalysis.mockResolvedValue(undefined);
    fetchJobMatch.mockResolvedValue(makeMatchDetail({ analysis: { status: 'pending', error: null } }));
    const client = makeClient();
    client.setQueryData(matchKeys.detail('job-1'), makeMatchDetail({ analysis: { status: 'failed', error: 'boom' } }));

    const { result } = renderHook(() => useRetryJobAnalysis('job-1'), { wrapper: wrapperFor(client) });
    act(() => result.current.mutate());

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    await waitFor(() => expect(client.getQueryState(matchKeys.detail('job-1'))?.isInvalidated).toBe(true));
  });
});
