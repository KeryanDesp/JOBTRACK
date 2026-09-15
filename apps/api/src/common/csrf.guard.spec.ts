import { ForbiddenException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { describe, expect, it, vi } from 'vitest';
import { CSRF_COOKIE, CSRF_HEADER, CsrfGuard } from './csrf.guard';

function contextFor(
  request: { method: string; cookies?: Record<string, string>; headers?: Record<string, string> },
  isPublic = false,
) {
  const reflector = new Reflector();
  vi.spyOn(reflector, 'getAllAndOverride').mockReturnValue(isPublic);
  const context = {
    switchToHttp: () => ({ getRequest: () => ({ cookies: {}, headers: {}, ...request }) }),
    getHandler: () => ({}),
    getClass: () => ({}),
  } as unknown as Parameters<CsrfGuard['canActivate']>[0];
  return { guard: new CsrfGuard(reflector), context };
}

describe('CsrfGuard', () => {
  it('ignore les requetes de lecture', () => {
    const { guard, context } = contextFor({ method: 'GET' });
    expect(guard.canActivate(context)).toBe(true);
  });

  it('ignore les routes publiques', () => {
    const { guard, context } = contextFor({ method: 'POST' }, true);
    expect(guard.canActivate(context)).toBe(true);
  });

  it('refuse une mutation sans jeton ou avec un jeton different', () => {
    const missing = contextFor({ method: 'POST', cookies: { [CSRF_COOKIE]: 'abc' } });
    expect(() => missing.guard.canActivate(missing.context)).toThrowError(ForbiddenException);

    const wrong = contextFor({
      method: 'DELETE',
      cookies: { [CSRF_COOKIE]: 'abc' },
      headers: { [CSRF_HEADER]: 'abd' },
    });
    expect(() => wrong.guard.canActivate(wrong.context)).toThrowError(
      'Requête refusée. Rechargez la page et réessayez.',
    );
  });

  it('accepte une mutation dont l_en-tete recopie le cookie', () => {
    const { guard, context } = contextFor({
      method: 'PATCH',
      cookies: { [CSRF_COOKIE]: 'jeton-identique' },
      headers: { [CSRF_HEADER]: 'jeton-identique' },
    });
    expect(guard.canActivate(context)).toBe(true);
  });
});
