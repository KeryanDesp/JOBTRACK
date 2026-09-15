import type { ExecutionContext, UnauthorizedException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import type { SessionUser } from '@jobtrack/shared';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { CSRF_COOKIE, csrfTokenFor } from '../../common/csrf.guard';
import { SESSION_COOKIE } from './auth.cookies';
import type { AuthService } from './auth.service';
import { AuthGuard } from './auth.guard';
import type { SessionService, TouchedSession } from './session.service';

const VALID_ID = 'a'.repeat(43);

const sessions = { touch: vi.fn(), destroy: vi.fn() };
const auth = { findSessionUser: vi.fn() };

function build(isPublic: boolean): AuthGuard {
  const reflector = new Reflector();
  vi.spyOn(reflector, 'getAllAndOverride').mockReturnValue(isPublic);
  return new AuthGuard(reflector, sessions as unknown as SessionService, auth as unknown as AuthService);
}

/** `response` par defaut : un double minimal qui absorbe les appels a setCookie sans planter. */
function contextFor(
  request: Record<string, unknown>,
  response: Record<string, unknown> = { setCookie: vi.fn() },
): ExecutionContext {
  return {
    switchToHttp: () => ({ getRequest: () => request, getResponse: () => response }),
    getHandler: () => undefined,
    getClass: () => undefined,
  } as unknown as ExecutionContext;
}

/** Attend un rejet et renvoie l'erreur, plutot que de la laisser remonter au test. */
async function captureError(promise: Promise<unknown>): Promise<UnauthorizedException> {
  try {
    await promise;
  } catch (error) {
    return error as UnauthorizedException;
  }
  throw new Error('La promesse a ete resolue : un rejet etait attendu.');
}

const STORED_SESSION: TouchedSession = {
  id: VALID_ID,
  userId: 'u1',
  userAgent: null,
  ip: null,
  createdAt: '2026-01-01T00:00:00.000Z',
  lastSeenAt: '2026-01-01T00:00:00.000Z',
  refreshed: false,
};

const STORED_USER: SessionUser = {
  id: 'u1',
  email: 'utilisateur@jobtrack.local',
  firstName: 'Utilisateur',
  lastName: 'Test',
};

beforeEach(() => {
  vi.clearAllMocks();
});

describe('AuthGuard', () => {
  it('laisse passer une route publique sans consulter la session', async () => {
    const guard = build(true);
    const context = contextFor({});

    await expect(guard.canActivate(context)).resolves.toBe(true);
    expect(sessions.touch).not.toHaveBeenCalled();
  });

  it('refuse sans cookie', async () => {
    const guard = build(false);

    const withEmptyCookies = await captureError(guard.canActivate(contextFor({ cookies: {} })));
    expect(withEmptyCookies.getResponse()).toMatchObject({ code: 'NOT_AUTHENTICATED' });

    // Sans plugin @fastify/cookie enregistre (ex. app de test minimale), `cookies`
    // est absent : le `?.` doit renvoyer 401, pas planter en 500.
    const withoutCookiesKey = await captureError(guard.canActivate(contextFor({})));
    expect(withoutCookiesKey.getResponse()).toMatchObject({ code: 'NOT_AUTHENTICATED' });

    expect(sessions.touch).not.toHaveBeenCalled();
  });

  it('refuse une signature invalide sans consulter Redis', async () => {
    const guard = build(false);
    const context = contextFor({
      cookies: { [SESSION_COOKIE]: 'valeur-signee' },
      unsignCookie: () => ({ valid: false, value: null, renew: false }),
    });

    const error = await captureError(guard.canActivate(context));
    expect(error.getResponse()).toMatchObject({ code: 'NOT_AUTHENTICATED' });
    expect(sessions.touch).not.toHaveBeenCalled();
  });

  it('refuse un identifiant malforme sans consulter Redis', async () => {
    const guard = build(false);
    const context = contextFor({
      cookies: { [SESSION_COOKIE]: 'valeur-signee' },
      unsignCookie: () => ({ valid: true, value: 'court', renew: false }),
    });

    const error = await captureError(guard.canActivate(context));
    expect(error.getResponse()).toMatchObject({ code: 'NOT_AUTHENTICATED' });
    expect(sessions.touch).not.toHaveBeenCalled();
  });

  it('refuse une session inconnue', async () => {
    sessions.touch.mockResolvedValueOnce(null);
    const guard = build(false);
    const context = contextFor({
      cookies: { [SESSION_COOKIE]: 'valeur-signee' },
      unsignCookie: () => ({ valid: true, value: VALID_ID, renew: false }),
    });

    const error = await captureError(guard.canActivate(context));
    expect(error.getResponse()).toMatchObject({ code: 'NOT_AUTHENTICATED' });
  });

  it('detruit la session d_un utilisateur supprime', async () => {
    sessions.touch.mockResolvedValueOnce(STORED_SESSION);
    auth.findSessionUser.mockResolvedValueOnce(null);
    const guard = build(false);
    const context = contextFor({
      cookies: { [SESSION_COOKIE]: 'valeur-signee' },
      unsignCookie: () => ({ valid: true, value: VALID_ID, renew: false }),
    });

    const error = await captureError(guard.canActivate(context));
    expect(error.getResponse()).toMatchObject({ code: 'NOT_AUTHENTICATED' });
    expect(sessions.destroy).toHaveBeenCalledWith(VALID_ID, 'u1');
  });

  it('attache utilisateur et session a la requete', async () => {
    sessions.touch.mockResolvedValueOnce(STORED_SESSION);
    auth.findSessionUser.mockResolvedValueOnce(STORED_USER);
    const guard = build(false);
    const request: Record<string, unknown> = {
      cookies: { [SESSION_COOKIE]: 'valeur-signee', [CSRF_COOKIE]: csrfTokenFor(VALID_ID) },
      unsignCookie: () => ({ valid: true, value: VALID_ID, renew: false }),
    };
    const context = contextFor(request);

    await expect(guard.canActivate(context)).resolves.toBe(true);
    expect(request.user).toEqual(STORED_USER);
    expect(request.session).toEqual(STORED_SESSION);
  });

  it('renouvelle les cookies quand la session vient d_etre rafraichie', async () => {
    sessions.touch.mockResolvedValueOnce({ ...STORED_SESSION, refreshed: true });
    auth.findSessionUser.mockResolvedValueOnce(STORED_USER);
    const guard = build(false);
    const setCookie = vi.fn<(name: string) => void>();
    const context = contextFor(
      {
        cookies: { [SESSION_COOKIE]: 'valeur-signee', [CSRF_COOKIE]: csrfTokenFor(VALID_ID) },
        unsignCookie: () => ({ valid: true, value: VALID_ID, renew: false }),
      },
      { setCookie },
    );

    await expect(guard.canActivate(context)).resolves.toBe(true);
    expect(setCookie).toHaveBeenCalledTimes(2);
    const cookieNames = setCookie.mock.calls.map(([name]) => name);
    expect(cookieNames).toEqual(expect.arrayContaining([SESSION_COOKIE, CSRF_COOKIE]));
  });

  it('ne renouvelle pas les cookies quand le jeton csrf est deja a jour', async () => {
    sessions.touch.mockResolvedValueOnce({ ...STORED_SESSION, refreshed: false });
    auth.findSessionUser.mockResolvedValueOnce(STORED_USER);
    const guard = build(false);
    const setCookie = vi.fn();
    const context = contextFor(
      {
        cookies: { [SESSION_COOKIE]: 'valeur-signee', [CSRF_COOKIE]: csrfTokenFor(VALID_ID) },
        unsignCookie: () => ({ valid: true, value: VALID_ID, renew: false }),
      },
      { setCookie },
    );

    await expect(guard.canActivate(context)).resolves.toBe(true);
    expect(setCookie).not.toHaveBeenCalled();
  });
});
