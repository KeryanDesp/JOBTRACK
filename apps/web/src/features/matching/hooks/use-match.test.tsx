import type { AnalyzeJobsResponseDto, JobListResponseDto, JobSummaryDto, MatchScoreDto } from '@jobtrack/shared';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, renderHook, waitFor } from '@testing-library/react';
import type { ReactNode } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
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
  return { items, total: items.length, page: 1, pageSize: 20, sync: { status: 'ok', syncedAt: null, message: null } };
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

function makeClient(): QueryClient {
  return new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
}

function wrapperFor(client: QueryClient) {
  return ({ children }: { children: ReactNode }) => <QueryClientProvider client={client}>{children}</QueryClientProvider>;
}

describe('useJobMatch', () => {
  it('renvoie le score detaille de l_offre demandee', async () => {
    const detail: MatchScoreDto = {
      score: 92,
      band: 'EXCELLENT',
      priority: 'VERY_HIGH',
      explanation: { top: [], weak: [] },
      factors: [],
      computedAt: '2026-09-17T00:00:00.000Z',
      analysis: { status: 'done', error: null },
      profileComplete: true,
      insufficientData: false,
    };
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

  it('expose l_etat notConfigured et profileComplete a partir de la derniere reponse', async () => {
    analyzeJobs.mockResolvedValue(makeAnalyzeResponse({ notConfigured: true, profileComplete: false, pending: 2 }));
    const client = makeClient();

    const { result } = renderHook(() => useAnalyzeJobs(), { wrapper: wrapperFor(client) });
    act(() => result.current.analyze(['job-1']));

    await waitFor(() => expect(result.current.pending).toBe(2));
    expect(result.current.notConfigured).toBe(true);
    expect(result.current.profileComplete).toBe(false);
  });
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

  it('ne sonde rien sans identifiant d_offre', () => {
    const client = makeClient();

    renderHook(() => useAnalysisPolling([]), { wrapper: wrapperFor(client) });

    expect(analyzeJobs).not.toHaveBeenCalled();
  });
});

describe('useRetryJobAnalysis', () => {
  it('invalide le score detaille en cache apres une relance reussie', async () => {
    retryJobAnalysis.mockResolvedValue(undefined);
    fetchJobMatch.mockResolvedValue({
      score: null,
      band: null,
      priority: null,
      explanation: { top: [], weak: [] },
      factors: [],
      computedAt: null,
      analysis: { status: 'pending', error: null },
      profileComplete: true,
      insufficientData: false,
    } satisfies MatchScoreDto);
    const client = makeClient();
    client.setQueryData(matchKeys.detail('job-1'), {
      score: null,
      band: null,
      priority: null,
      explanation: { top: [], weak: [] },
      factors: [],
      computedAt: null,
      analysis: { status: 'failed', error: 'boom' },
      profileComplete: true,
      insufficientData: false,
    } satisfies MatchScoreDto);

    const { result } = renderHook(() => useRetryJobAnalysis('job-1'), { wrapper: wrapperFor(client) });
    act(() => result.current.mutate());

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    await waitFor(() => expect(client.getQueryState(matchKeys.detail('job-1'))?.isInvalidated).toBe(true));
  });
});
