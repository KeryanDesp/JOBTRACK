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

    await expect(apiRequest('/auth/login', { method: 'POST' })).rejects.toThrowError(
      new ApiError('Identifiants invalides.', 401, 'INVALID_CREDENTIALS'),
    );
  });

  it('remplace une reponse illisible par un message francais generique', async () => {
    stubFetch(new Response('<html>Bad Gateway</html>', { status: 502 }));

    await expect(apiRequest('/health')).rejects.toMatchObject({
      status: 502,
      message: 'Une erreur est survenue. Veuillez réessayer.',
    });
  });

  it('signale une panne reseau avec un message comprehensible', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new TypeError('Failed to fetch')));

    await expect(apiRequest('/health')).rejects.toMatchObject({
      status: 0,
      message: 'Connexion au serveur impossible. Vérifiez votre connexion internet.',
    });
  });
});
