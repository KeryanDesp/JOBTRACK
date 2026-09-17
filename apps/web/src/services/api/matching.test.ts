import type { AnalyzeJobsResponseDto, MatchScoreDto } from '@jobtrack/shared';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { analyzeJobs, fetchJobMatch, retryJobAnalysis } from './matching';

afterEach(() => vi.unstubAllGlobals());

function stubFetch(body: unknown, status = 200) {
  const fetchMock = vi.fn<typeof fetch>().mockResolvedValue(Response.json(body, { status }));
  vi.stubGlobal('fetch', fetchMock);
  return fetchMock;
}

function requestedUrl(fetchMock: ReturnType<typeof vi.fn<typeof fetch>>): string {
  const [url] = fetchMock.mock.calls[0] as [string, RequestInit];
  return url;
}

describe('analyzeJobs', () => {
  it('poste jobIds en json sur /jobs/analyses et renvoie la reponse', async () => {
    const dto: AnalyzeJobsResponseDto = {
      analyzed: 1,
      pending: 0,
      failed: 0,
      notConfigured: false,
      profileComplete: true,
      scores: { 'job-1': null },
    };
    const fetchMock = stubFetch(dto);

    const result = await analyzeJobs(['job-1', 'job-2']);

    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url.endsWith('/jobs/analyses')).toBe(true);
    expect(init.method).toBe('POST');
    expect(init.body).toBe(JSON.stringify({ jobIds: ['job-1', 'job-2'] }));
    expect(result).toEqual(dto);
  });
});

describe('fetchJobMatch', () => {
  it('appelle /jobs/:id/match et renvoie le score detaille', async () => {
    const dto: MatchScoreDto = {
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
    const fetchMock = stubFetch(dto);

    const result = await fetchJobMatch('job-1');

    expect(requestedUrl(fetchMock).endsWith('/jobs/job-1/match')).toBe(true);
    expect(result).toEqual(dto);
  });
});

describe('retryJobAnalysis', () => {
  it('poste sur /jobs/:id/analyses/retry et resout sans corps sur un 202 vide', async () => {
    const fetchMock = vi.fn<typeof fetch>().mockResolvedValue(new Response(null, { status: 202 }));
    vi.stubGlobal('fetch', fetchMock);

    const result = await retryJobAnalysis('job-1');

    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url.endsWith('/jobs/job-1/analyses/retry')).toBe(true);
    expect(init.method).toBe('POST');
    expect(result).toBeUndefined();
  });
});
