import type { JobSearchQuery } from '@jobtrack/shared';
import { jobSearchQuerySchema } from '@jobtrack/shared';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { fetchJob, fetchJobsCapabilities, fetchSavedJobs, saveJob, searchCommunes, searchJobs, unsaveJob } from './jobs';

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

describe('searchJobs', () => {
  it('appelle /jobs sans chaine de requete quand la recherche est la valeur par defaut', async () => {
    const fetchMock = stubFetch({ items: [], total: 0, page: 1, pageSize: 20, sync: { status: 'ok', syncedAt: null, message: null } });
    const query = jobSearchQuerySchema.parse({});

    await searchJobs(query);

    expect(requestedUrl(fetchMock).endsWith('/jobs')).toBe(true);
  });

  it('construit la chaine de requete avec les cles courtes du contrat partage', async () => {
    const fetchMock = stubFetch({ items: [], total: 0, page: 2, pageSize: 20, sync: { status: 'ok', syncedAt: null, message: null } });
    const query: JobSearchQuery = jobSearchQuerySchema.parse({
      q: 'developpeur',
      communes: ['57463'],
      distance: 25,
      contractTypes: ['CDI'],
      sort: 'salary',
      tab: 'new',
      page: 2,
    });

    await searchJobs(query);

    const url = requestedUrl(fetchMock);
    const search = new URL(url).search;
    expect(search).toContain('q=developpeur');
    expect(search).toContain('lieu=57463');
    expect(search).toContain('rayon=25');
    expect(search).toContain('contrat=CDI');
    expect(search).toContain('tri=salary');
    expect(search).toContain('onglet=new');
    expect(search).toContain('page=2');
    // `pageSize` n'est jamais porte par l'URL (fixe a 20 par le contrat).
    expect(search).not.toContain('pageSize');
  });

  it('renvoie les donnees json de la reponse', async () => {
    const dto = { items: [], total: 0, page: 1, pageSize: 20, sync: { status: 'ok', syncedAt: null, message: null } };
    stubFetch(dto);

    const result = await searchJobs(jobSearchQuerySchema.parse({}));

    expect(result).toEqual(dto);
  });
});

describe('fetchJobsCapabilities', () => {
  it('appelle /jobs/capabilities', async () => {
    const fetchMock = stubFetch({ sources: { franceTravail: true } });

    const result = await fetchJobsCapabilities();

    expect(requestedUrl(fetchMock).endsWith('/jobs/capabilities')).toBe(true);
    expect(result).toEqual({ sources: { franceTravail: true } });
  });
});

describe('fetchJob', () => {
  it('appelle /jobs/:id', async () => {
    const fetchMock = stubFetch({ id: 'job-1' });

    await fetchJob('job-1');

    expect(requestedUrl(fetchMock).endsWith('/jobs/job-1')).toBe(true);
  });
});

describe('fetchSavedJobs', () => {
  it('appelle /jobs/saved', async () => {
    const fetchMock = stubFetch([]);

    await fetchSavedJobs();

    expect(requestedUrl(fetchMock).endsWith('/jobs/saved')).toBe(true);
  });
});

describe('saveJob et unsaveJob', () => {
  it('poste sur /jobs/:id/save et resout sans corps sur un 204', async () => {
    const fetchMock = vi.fn<typeof fetch>().mockResolvedValue(new Response(null, { status: 204 }));
    vi.stubGlobal('fetch', fetchMock);

    const result = await saveJob('job-1');

    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url.endsWith('/jobs/job-1/save')).toBe(true);
    expect(init.method).toBe('POST');
    expect(result).toBeUndefined();
  });

  it('retire avec DELETE sur /jobs/:id/save et resout sans corps sur un 204', async () => {
    const fetchMock = vi.fn<typeof fetch>().mockResolvedValue(new Response(null, { status: 204 }));
    vi.stubGlobal('fetch', fetchMock);

    const result = await unsaveJob('job-1');

    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url.endsWith('/jobs/job-1/save')).toBe(true);
    expect(init.method).toBe('DELETE');
    expect(result).toBeUndefined();
  });
});

describe('searchCommunes', () => {
  it('encode le terme de recherche dans /jobs/communes', async () => {
    const fetchMock = stubFetch([]);

    await searchCommunes('saint étienne');

    const url = requestedUrl(fetchMock);
    expect(new URL(url).searchParams.get('q')).toBe('saint étienne');
  });
});
