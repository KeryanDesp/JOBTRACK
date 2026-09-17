import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  createLetter,
  deleteLetter,
  deleteResume,
  fetchBaseResume,
  fetchLetter,
  fetchLetters,
  fetchResume,
  fetchResumes,
  tailorResume,
  updateLetter,
  updateResume,
  updateResumeTemplate,
} from './resume';

afterEach(() => vi.unstubAllGlobals());

// `undefined` (204 sans corps) n'est pas serialisable par `Response.json` :
// reponse vide directe dans ce cas, comme le lirait vraiment un 204 (texte vide).
function stubFetch(body: unknown, status = 200) {
  const response = body === undefined ? new Response(null, { status }) : Response.json(body, { status });
  const fetchMock = vi.fn<typeof fetch>().mockResolvedValue(response);
  vi.stubGlobal('fetch', fetchMock);
  return fetchMock;
}

function requestedCall(fetchMock: ReturnType<typeof vi.fn<typeof fetch>>): [string, RequestInit] {
  return fetchMock.mock.calls[0] as [string, RequestInit];
}

describe('fetchBaseResume', () => {
  it('appelle GET /resume/base', async () => {
    const fetchMock = stubFetch({ content: {}, template: 'CLASSIC', profileComplete: true });
    await fetchBaseResume();
    const [url, init] = requestedCall(fetchMock);
    expect(url.endsWith('/resume/base')).toBe(true);
    expect(init.method ?? 'GET').toBe('GET');
  });
});

describe('updateResumeTemplate', () => {
  it('appelle PATCH /resume/template avec le modele choisi', async () => {
    const fetchMock = stubFetch({ content: {}, template: 'MODERN', profileComplete: true });
    await updateResumeTemplate({ template: 'MODERN' });
    const [url, init] = requestedCall(fetchMock);
    expect(url.endsWith('/resume/template')).toBe(true);
    expect(init.method).toBe('PATCH');
    expect(JSON.parse(init.body as string)).toEqual({ template: 'MODERN' });
  });
});

describe('fetchResumes', () => {
  it('appelle GET /resume', async () => {
    const fetchMock = stubFetch([]);
    await fetchResumes();
    const [url, init] = requestedCall(fetchMock);
    expect(url.endsWith('/resume')).toBe(true);
    expect(init.method ?? 'GET').toBe('GET');
  });
});

describe('tailorResume', () => {
  it('appelle POST /resume/tailor avec l offre et le modele', async () => {
    const fetchMock = stubFetch({ id: 'resume-1' }, 201);
    await tailorResume({ jobId: 'job-1', template: 'CLASSIC' });
    const [url, init] = requestedCall(fetchMock);
    expect(url.endsWith('/resume/tailor')).toBe(true);
    expect(init.method).toBe('POST');
    expect(JSON.parse(init.body as string)).toEqual({ jobId: 'job-1', template: 'CLASSIC' });
  });
});

describe('fetchResume', () => {
  it('appelle GET /resume/:id', async () => {
    const fetchMock = stubFetch({ id: 'resume-1' });
    await fetchResume('resume-1');
    const [url, init] = requestedCall(fetchMock);
    expect(url.endsWith('/resume/resume-1')).toBe(true);
    expect(init.method ?? 'GET').toBe('GET');
  });
});

describe('updateResume', () => {
  it('appelle PATCH /resume/:id avec le contenu', async () => {
    const fetchMock = stubFetch({ id: 'resume-1' });
    const content: Parameters<typeof updateResume>[1]['content'] = {
      schemaVersion: 1,
      identity: { firstName: 'Alice', lastName: 'Martin', title: null },
      summary: '',
      experiences: [],
      educations: [],
      skills: [],
      languages: [],
      certifications: [],
      projects: [],
    };
    await updateResume('resume-1', { content });
    const [url, init] = requestedCall(fetchMock);
    expect(url.endsWith('/resume/resume-1')).toBe(true);
    expect(init.method).toBe('PATCH');
  });
});

describe('deleteResume', () => {
  it('appelle DELETE /resume/:id', async () => {
    const fetchMock = stubFetch(undefined, 204);
    await deleteResume('resume-1');
    const [url, init] = requestedCall(fetchMock);
    expect(url.endsWith('/resume/resume-1')).toBe(true);
    expect(init.method).toBe('DELETE');
  });
});

describe('fetchLetters', () => {
  it('appelle GET /resume/letters', async () => {
    const fetchMock = stubFetch([]);
    await fetchLetters();
    const [url, init] = requestedCall(fetchMock);
    expect(url.endsWith('/resume/letters')).toBe(true);
    expect(init.method ?? 'GET').toBe('GET');
  });
});

describe('createLetter', () => {
  it('appelle POST /resume/letters avec l offre et le ton', async () => {
    const fetchMock = stubFetch({ id: 'letter-1' }, 201);
    await createLetter({ jobId: 'job-1', tone: 'PROFESSIONAL' });
    const [url, init] = requestedCall(fetchMock);
    expect(url.endsWith('/resume/letters')).toBe(true);
    expect(init.method).toBe('POST');
    expect(JSON.parse(init.body as string)).toEqual({ jobId: 'job-1', tone: 'PROFESSIONAL' });
  });
});

describe('fetchLetter', () => {
  it('appelle GET /resume/letters/:id', async () => {
    const fetchMock = stubFetch({ id: 'letter-1' });
    await fetchLetter('letter-1');
    const [url, init] = requestedCall(fetchMock);
    expect(url.endsWith('/resume/letters/letter-1')).toBe(true);
    expect(init.method ?? 'GET').toBe('GET');
  });
});

describe('updateLetter', () => {
  it('appelle PATCH /resume/letters/:id', async () => {
    const fetchMock = stubFetch({ id: 'letter-1' });
    await updateLetter('letter-1', {
      content: { recipient: null, subject: 'Objet', greeting: 'Bonjour', paragraphs: ['Texte.'], closing: 'Cordialement', signature: 'Alice' },
    });
    const [url, init] = requestedCall(fetchMock);
    expect(url.endsWith('/resume/letters/letter-1')).toBe(true);
    expect(init.method).toBe('PATCH');
  });
});

describe('deleteLetter', () => {
  it('appelle DELETE /resume/letters/:id', async () => {
    const fetchMock = stubFetch(undefined, 204);
    await deleteLetter('letter-1');
    const [url, init] = requestedCall(fetchMock);
    expect(url.endsWith('/resume/letters/letter-1')).toBe(true);
    expect(init.method).toBe('DELETE');
  });
});
