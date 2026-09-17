import type { ApplicationListQueryInput } from '@jobtrack/shared';
import { createFromJobSchema } from '@jobtrack/shared';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  createApplication,
  deleteApplication,
  fetchApplication,
  fetchApplicationBoard,
  fetchApplicationStats,
  fetchApplications,
  moveApplication,
  updateApplication,
} from './applications';

afterEach(() => vi.unstubAllGlobals());

function stubFetch(body: unknown, status = 200) {
  const response = body === undefined ? new Response(null, { status }) : Response.json(body, { status });
  const fetchMock = vi.fn<typeof fetch>().mockResolvedValue(response);
  vi.stubGlobal('fetch', fetchMock);
  return fetchMock;
}

function requestedCall(fetchMock: ReturnType<typeof vi.fn<typeof fetch>>): [string, RequestInit] {
  return fetchMock.mock.calls[0] as [string, RequestInit];
}

const EMPTY_LIST_RESPONSE = { items: [], page: 1, limit: 20, total: 0 };

describe('fetchApplications', () => {
  it('appelle /applications sans chaine de requete quand tous les champs sont par defaut', async () => {
    const fetchMock = stubFetch(EMPTY_LIST_RESPONSE);
    const query: ApplicationListQueryInput = { tab: 'all', page: 1, limit: 20, sort: 'updated_desc' };

    await fetchApplications(query);

    const [url, init] = requestedCall(fetchMock);
    expect(url.endsWith('/applications')).toBe(true);
    expect(init.method ?? 'GET').toBe('GET');
  });

  it('omet les champs indefinis (aucun champ fourni)', async () => {
    const fetchMock = stubFetch(EMPTY_LIST_RESPONSE);

    await fetchApplications({});

    const [url] = requestedCall(fetchMock);
    expect(url.endsWith('/applications')).toBe(true);
  });

  it('construit la chaine de requete avec seulement les valeurs non par defaut', async () => {
    const fetchMock = stubFetch(EMPTY_LIST_RESPONSE);
    const query: ApplicationListQueryInput = { tab: 'interview', q: 'react', page: 2, limit: 10, sort: 'company_asc' };

    await fetchApplications(query);

    const [url] = requestedCall(fetchMock);
    const search = new URL(url).searchParams;
    expect(search.get('tab')).toBe('interview');
    expect(search.get('q')).toBe('react');
    expect(search.get('page')).toBe('2');
    expect(search.get('limit')).toBe('10');
    expect(search.get('sort')).toBe('company_asc');
  });

  it('omet q quand il est une chaine vide', async () => {
    const fetchMock = stubFetch(EMPTY_LIST_RESPONSE);

    await fetchApplications({ q: '' });

    const [url] = requestedCall(fetchMock);
    expect(new URL(url).searchParams.has('q')).toBe(false);
  });
});

describe('fetchApplicationStats', () => {
  it('appelle GET /applications/stats', async () => {
    const fetchMock = stubFetch({ total: 0, byStatus: {}, appliedThisWeek: 0, interviewRate: null });
    await fetchApplicationStats();
    const [url, init] = requestedCall(fetchMock);
    expect(url.endsWith('/applications/stats')).toBe(true);
    expect(init.method ?? 'GET').toBe('GET');
  });
});

describe('fetchApplicationBoard', () => {
  it('appelle GET /applications/board', async () => {
    const fetchMock = stubFetch({ columns: {} });
    await fetchApplicationBoard();
    const [url, init] = requestedCall(fetchMock);
    expect(url.endsWith('/applications/board')).toBe(true);
    expect(init.method ?? 'GET').toBe('GET');
  });
});

describe('fetchApplication', () => {
  it('appelle GET /applications/:id', async () => {
    const fetchMock = stubFetch({ id: 'app-1' });
    await fetchApplication('app-1');
    const [url, init] = requestedCall(fetchMock);
    expect(url.endsWith('/applications/app-1')).toBe(true);
    expect(init.method ?? 'GET').toBe('GET');
  });
});

describe('createApplication', () => {
  it('appelle POST /applications avec l entree fournie', async () => {
    const fetchMock = stubFetch({ id: 'app-1' }, 201);
    const input = createFromJobSchema.parse({ jobId: 'job-1' });
    await createApplication(input);
    const [url, init] = requestedCall(fetchMock);
    expect(url.endsWith('/applications')).toBe(true);
    expect(init.method).toBe('POST');
    expect(JSON.parse(init.body as string)).toEqual(input);
  });
});

describe('updateApplication', () => {
  it('appelle PATCH /applications/:id', async () => {
    const fetchMock = stubFetch({ id: 'app-1' });
    await updateApplication('app-1', { status: 'INTERVIEW' });
    const [url, init] = requestedCall(fetchMock);
    expect(url.endsWith('/applications/app-1')).toBe(true);
    expect(init.method).toBe('PATCH');
    expect(JSON.parse(init.body as string)).toEqual({ status: 'INTERVIEW' });
  });
});

describe('moveApplication', () => {
  it('appelle PATCH /applications/:id/move avec le statut et la position', async () => {
    const fetchMock = stubFetch({ id: 'app-1' });
    await moveApplication('app-1', { status: 'OFFER', position: 2 });
    const [url, init] = requestedCall(fetchMock);
    expect(url.endsWith('/applications/app-1/move')).toBe(true);
    expect(init.method).toBe('PATCH');
    expect(JSON.parse(init.body as string)).toEqual({ status: 'OFFER', position: 2 });
  });
});

describe('deleteApplication', () => {
  it('appelle DELETE /applications/:id', async () => {
    const fetchMock = stubFetch(undefined, 204);
    await deleteApplication('app-1');
    const [url, init] = requestedCall(fetchMock);
    expect(url.endsWith('/applications/app-1')).toBe(true);
    expect(init.method).toBe('DELETE');
  });
});
