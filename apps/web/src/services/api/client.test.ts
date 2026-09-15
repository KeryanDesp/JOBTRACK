import { afterEach, describe, expect, it, vi } from 'vitest';
import { ApiError, apiRequest } from './client';

afterEach(() => vi.unstubAllGlobals());

function stubFetch(response: Response): void {
  vi.stubGlobal('fetch', vi.fn().mockResolvedValue(response));
}

describe('apiRequest', () => {
  it('renvoie le corps json et transmet les cookies', async () => {
    const fetchMock = vi.fn().mockResolvedValue(Response.json({ status: 'ok' }));
    vi.stubGlobal('fetch', fetchMock);

    await expect(apiRequest('/health')).resolves.toEqual({ status: 'ok' });

    const [, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(init.credentials).toBe('include');
  });

  it('lève une ApiError portant le message lisible du serveur', async () => {
    stubFetch(Response.json({ message: 'Identifiants invalides.', code: 'INVALID_CREDENTIALS' }, { status: 401 }));

    // toMatchObject et non toThrowError : ce dernier ne compare que le message.
    await expect(apiRequest('/auth/login', { method: 'POST', body: '{}' })).rejects.toMatchObject({
      name: 'ApiError',
      status: 401,
      code: 'INVALID_CREDENTIALS',
      message: 'Identifiants invalides.',
    });
  });

  it('remplace une reponse illisible par un message francais generique', async () => {
    stubFetch(new Response('<html>Bad Gateway</html>', { status: 502 }));

    await expect(apiRequest('/health')).rejects.toMatchObject({
      status: 502,
      message: 'Une erreur est survenue. Veuillez réessayer.',
    });
  });

  it('conserve les en-tetes fournis sous forme d_instance Headers', async () => {
    // Un spread d'objet sur une instance Headers donne {} : les en-têtes seraient perdus.
    const fetchMock = vi.fn().mockResolvedValue(Response.json({}));
    vi.stubGlobal('fetch', fetchMock);

    await apiRequest('/profile', {
      method: 'PATCH',
      body: '{}',
      headers: new Headers({ 'x-csrf-token': 'jeton' }),
    });

    const [, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    const sent = new Headers(init.headers);
    expect(sent.get('x-csrf-token')).toBe('jeton');
    expect(sent.get('content-type')).toBe('application/json');
  });

  it('ne force pas de Content-Type sur un FormData', async () => {
    const fetchMock = vi.fn().mockResolvedValue(Response.json({}));
    vi.stubGlobal('fetch', fetchMock);

    await apiRequest('/resume/import', { method: 'POST', body: new FormData() });

    const [, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(new Headers(init.headers).has('content-type')).toBe(false);
  });

  it('supprime la barre finale de l_URL de base', async () => {
    const fetchMock = vi.fn().mockResolvedValue(Response.json({}));
    vi.stubGlobal('fetch', fetchMock);

    await apiRequest('/health');

    const [url] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).not.toContain('//health');
    expect(url.endsWith('/health')).toBe(true);
  });

  it('signale une panne reseau avec un message comprehensible', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new TypeError('Failed to fetch')));

    await expect(apiRequest('/health')).rejects.toMatchObject({
      status: 0,
      message: 'Connexion au serveur impossible. Vérifiez votre connexion internet.',
    });
  });
});
