import { ForbiddenException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { describe, expect, it, vi } from 'vitest';
import { CSRF_HEADER, CsrfGuard, csrfTokenFor } from './csrf.guard';

const SESSION_ID = 'a'.repeat(43);
const TOKEN = csrfTokenFor(SESSION_ID);

interface RequestShape {
  method: string;
  headers?: Record<string, unknown>;
  session?: { id: string };
}

function contextFor(request: RequestShape, exempt = false) {
  const reflector = new Reflector();
  vi.spyOn(reflector, 'getAllAndOverride').mockReturnValue(exempt);
  const context = {
    switchToHttp: () => ({ getRequest: () => ({ headers: {}, ...request }) }),
    getHandler: () => ({}),
    getClass: () => ({}),
  } as unknown as Parameters<CsrfGuard['canActivate']>[0];
  return { guard: new CsrfGuard(reflector), context };
}

describe('CsrfGuard', () => {
  it('ignore les methodes sures', () => {
    expect(contextFor({ method: 'GET' }).guard.canActivate(contextFor({ method: 'GET' }).context)).toBe(
      true,
    );
    const head = contextFor({ method: 'HEAD' });
    expect(head.guard.canActivate(head.context)).toBe(true);
  });

  it('ignore les routes marquees NoCsrf', () => {
    const { guard, context } = contextFor({ method: 'POST' }, true);
    expect(guard.canActivate(context)).toBe(true);
  });

  it('refuse une mutation sans session', () => {
    const { guard, context } = contextFor({
      method: 'POST',
      headers: { [CSRF_HEADER]: TOKEN },
    });
    expect(() => guard.canActivate(context)).toThrowError(ForbiddenException);
  });

  it('refuse un en-tete absent ou de longueur differente', () => {
    const missing = contextFor({ method: 'POST', session: { id: SESSION_ID } });
    expect(() => missing.guard.canActivate(missing.context)).toThrowError(ForbiddenException);

    const shorter = contextFor({
      method: 'PUT',
      session: { id: SESSION_ID },
      headers: { [CSRF_HEADER]: TOKEN.slice(1) },
    });
    expect(() => shorter.guard.canActivate(shorter.context)).toThrowError(ForbiddenException);
  });

  it('refuse un en-tete de meme longueur mais different', () => {
    const tampered = `${TOKEN.slice(0, -1)}${TOKEN.at(-1) === 'x' ? 'y' : 'x'}`;
    const { guard, context } = contextFor({
      method: 'DELETE',
      session: { id: SESSION_ID },
      headers: { [CSRF_HEADER]: tampered },
    });
    expect(() => guard.canActivate(context)).toThrowError(
      'Requête refusée. Rechargez la page et réessayez.',
    );
  });

  it('refuse un en-tete duplique', () => {
    const { guard, context } = contextFor({
      method: 'POST',
      session: { id: SESSION_ID },
      headers: { [CSRF_HEADER]: ['a', 'b'] },
    });
    expect(() => guard.canActivate(context)).toThrowError(ForbiddenException);
  });

  it('accepte un en-tete egal au jeton de la session', () => {
    const { guard, context } = contextFor({
      method: 'PATCH',
      session: { id: SESSION_ID },
      headers: { [CSRF_HEADER]: TOKEN },
    });
    expect(guard.canActivate(context)).toBe(true);

    // Le jeton est déterministe pour une session donnée, et différent pour une autre.
    expect(csrfTokenFor(SESSION_ID)).toBe(TOKEN);
    expect(csrfTokenFor('b'.repeat(43))).not.toBe(TOKEN);
  });
});
