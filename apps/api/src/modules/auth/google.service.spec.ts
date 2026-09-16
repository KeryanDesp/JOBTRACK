import { createHash } from 'node:crypto';
import { UnauthorizedException } from '@nestjs/common';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { GoogleService, type GoogleConfig } from './google.service';

const CONFIG: GoogleConfig = {
  clientId: 'client-id',
  clientSecret: 'client-secret',
  callbackUrl: 'http://localhost:3001/api/v1/auth/google/callback',
};
const service = new GoogleService(CONFIG);

/** `header.payload.signature` en base64url, comme un vrai jeton — la signature n'est jamais vérifiée. */
function fakeIdToken(claims: Record<string, unknown>): string {
  const header = Buffer.from(JSON.stringify({ alg: 'RS256', typ: 'JWT' })).toString('base64url');
  const payload = Buffer.from(JSON.stringify(claims)).toString('base64url');
  return `${header}.${payload}.signature-non-verifiee`;
}

function validClaims(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    aud: CONFIG.clientId,
    iss: 'https://accounts.google.com',
    exp: Math.floor(Date.now() / 1000) + 3600,
    sub: '1234567890',
    email: ' Personne@Gmail.com ',
    email_verified: true,
    given_name: 'Personne',
    family_name: 'Exemple',
    ...overrides,
  };
}

afterEach(() => vi.unstubAllGlobals());

describe('GoogleService', () => {
  it('construit une url d_autorisation avec le state, pkce et les scopes attendus', () => {
    const challenge = createHash('sha256').update('un-verifieur').digest('base64url');
    const url = new URL(service.buildAuthUrl('mon-state', challenge));

    expect(url.origin + url.pathname).toBe('https://accounts.google.com/o/oauth2/v2/auth');
    expect(url.searchParams.get('client_id')).toBe('client-id');
    expect(url.searchParams.get('redirect_uri')).toBe(CONFIG.callbackUrl);
    expect(url.searchParams.get('state')).toBe('mon-state');
    expect(url.searchParams.get('response_type')).toBe('code');
    expect(url.searchParams.get('scope')).toContain('email');
    expect(url.searchParams.get('code_challenge')).toBe(challenge);
    expect(url.searchParams.get('code_challenge_method')).toBe('S256');
  });

  it('echange le code contre le profil google normalise via le jeton d_identite', async () => {
    const idToken = fakeIdToken(validClaims());
    const fetchMock = vi.fn<typeof fetch>().mockResolvedValueOnce(Response.json({ id_token: idToken }));
    vi.stubGlobal('fetch', fetchMock);

    const profile = await service.exchangeCode('code-autorisation', 'le-verifieur');

    expect(profile).toEqual({
      providerAccountId: '1234567890',
      email: 'personne@gmail.com',
      firstName: 'Personne',
      lastName: 'Exemple',
    });
    // Un seul aller-retour (le jeton d'identité remplace l'appel userinfo) ; le secret et le
    // vérifieur PKCE ne partent que vers l'endpoint de jeton.
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [tokenUrl, tokenInit] = fetchMock.mock.calls[0] ?? [];
    expect(String(tokenUrl as string | URL)).toBe('https://oauth2.googleapis.com/token');
    const body = String(tokenInit?.body as URLSearchParams | undefined);
    expect(body).toContain('client_secret=client-secret');
    expect(body).toContain('code_verifier=le-verifieur');
  });

  it('refuse un echange de code rejete par google', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn<typeof fetch>().mockResolvedValue(new Response('{"error":"invalid_grant"}', { status: 400 })),
    );

    await expect(service.exchangeCode('code-perime', 'verifieur')).rejects.toBeInstanceOf(UnauthorizedException);
  });

  it('refuse un google qui ne repond pas (timeout ou panne reseau)', async () => {
    vi.stubGlobal('fetch', vi.fn<typeof fetch>().mockRejectedValue(new DOMException('', 'TimeoutError')));

    await expect(service.exchangeCode('code', 'verifieur')).rejects.toBeInstanceOf(UnauthorizedException);
  });

  it('refuse un email non verifie', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn<typeof fetch>().mockResolvedValueOnce(
        Response.json({ id_token: fakeIdToken(validClaims({ email_verified: false })) }),
      ),
    );

    await expect(service.exchangeCode('code', 'verifieur')).rejects.toBeInstanceOf(UnauthorizedException);
  });

  it('refuse un jeton d_identite destine a un autre client (aud incorrect)', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn<typeof fetch>().mockResolvedValueOnce(
        Response.json({ id_token: fakeIdToken(validClaims({ aud: 'un-autre-client' })) }),
      ),
    );

    await expect(service.exchangeCode('code', 'verifieur')).rejects.toBeInstanceOf(UnauthorizedException);
  });
});
