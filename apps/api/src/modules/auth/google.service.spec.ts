import { UnauthorizedException } from '@nestjs/common';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { GoogleService, type GoogleConfig } from './google.service';

const CONFIG: GoogleConfig = {
  clientId: 'client-id',
  clientSecret: 'client-secret',
  callbackUrl: 'http://localhost:3001/api/v1/auth/google/callback',
};
const service = new GoogleService(CONFIG);

afterEach(() => vi.unstubAllGlobals());

describe('GoogleService', () => {
  it('construit une url d_autorisation avec le state et les scopes attendus', () => {
    const url = new URL(service.buildAuthUrl('mon-state'));

    expect(url.origin + url.pathname).toBe('https://accounts.google.com/o/oauth2/v2/auth');
    expect(url.searchParams.get('client_id')).toBe('client-id');
    expect(url.searchParams.get('redirect_uri')).toBe(CONFIG.callbackUrl);
    expect(url.searchParams.get('state')).toBe('mon-state');
    expect(url.searchParams.get('response_type')).toBe('code');
    expect(url.searchParams.get('scope')).toContain('email');
  });

  it('echange le code contre le profil google normalise', async () => {
    const fetchMock = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(Response.json({ access_token: 'jeton-acces' }))
      .mockResolvedValueOnce(
        Response.json({
          sub: '1234567890',
          email: ' Personne@Gmail.com ',
          email_verified: true,
          given_name: 'Personne',
          family_name: 'Exemple',
        }),
      );
    vi.stubGlobal('fetch', fetchMock);

    const profile = await service.exchangeCode('code-autorisation');

    expect(profile).toEqual({
      providerAccountId: '1234567890',
      email: 'personne@gmail.com',
      firstName: 'Personne',
      lastName: 'Exemple',
    });
    // Le secret ne part que vers l'endpoint de jeton, jamais vers userinfo.
    // Casts : `fetch` accepte des types de body/URL trop larges pour un `String()` non ambigu
    // aux yeux d'ESLint (`no-base-to-string`), alors qu'ici c'est toujours une string / des URLSearchParams.
    const [tokenUrl, tokenInit] = fetchMock.mock.calls[0] ?? [];
    expect(String(tokenUrl as string | URL)).toBe('https://oauth2.googleapis.com/token');
    expect(String(tokenInit?.body as URLSearchParams | undefined)).toContain('client_secret=client-secret');
  });

  it('refuse un echange rejete ou un email non verifie', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn<typeof fetch>().mockResolvedValue(new Response('{"error":"invalid_grant"}', { status: 400 })),
    );
    await expect(service.exchangeCode('code-perime')).rejects.toBeInstanceOf(UnauthorizedException);

    vi.stubGlobal(
      'fetch',
      vi
        .fn<typeof fetch>()
        .mockResolvedValueOnce(Response.json({ access_token: 'jeton' }))
        .mockResolvedValueOnce(Response.json({ sub: '1', email: 'x@y.z', email_verified: false })),
    );
    await expect(service.exchangeCode('code')).rejects.toBeInstanceOf(UnauthorizedException);
  });
});
