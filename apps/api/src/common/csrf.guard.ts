import { createHmac, timingSafeEqual } from 'node:crypto';
import { type CanActivate, type ExecutionContext, ForbiddenException, Injectable } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { env } from '../config/env';
import type { AuthenticatedRequest } from '../modules/auth/auth.guard';
import { NO_CSRF_KEY } from './decorators/no-csrf.decorator';

export const CSRF_COOKIE = 'jt_csrf';
export const CSRF_HEADER = 'x-csrf-token';

/** Méthodes sûres (RFC 9110) : liste blanche, tout le reste est une mutation. */
const SAFE_METHODS = new Set(['GET', 'HEAD', 'OPTIONS']);

/** Jeton CSRF dérivé de la session : posé dans le cookie lisible, attendu dans l'en-tête. */
export function csrfTokenFor(sessionId: string): string {
  return createHmac('sha256', env.SESSION_SECRET).update(sessionId).digest('base64url');
}

/**
 * Le jeton est lié à la session (HMAC du secret serveur sur l'identifiant de session) :
 * un site tiers ne peut ni le lire (CORS + cookie de session httpOnly) ni le forger,
 * et un cookie déposé par un sous-domaine compromis ne correspond à aucune session.
 * S'exécute après AuthGuard : `request.session` est garanti sur une route non publique.
 */
@Injectable()
export class CsrfGuard implements CanActivate {
  constructor(private readonly reflector: Reflector) {}

  canActivate(context: ExecutionContext): boolean {
    const exempt = this.reflector.getAllAndOverride<boolean | undefined>(NO_CSRF_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (exempt) return true;

    const request = context
      .switchToHttp()
      .getRequest<Partial<AuthenticatedRequest> & { method: string; headers: Record<string, unknown> }>();
    if (SAFE_METHODS.has(request.method)) return true;

    const header = request.headers[CSRF_HEADER];
    const session = request.session;
    if (!session || typeof header !== 'string' || !sameToken(csrfTokenFor(session.id), header)) {
      throw new ForbiddenException({
        code: 'CSRF_MISMATCH',
        message: 'Requête refusée. Rechargez la page et réessayez.',
      });
    }
    return true;
  }
}

/** Comparaison en temps constant ; longueurs différentes → faux sans lever. */
function sameToken(expected: string, actual: string): boolean {
  const left = Buffer.from(expected);
  const right = Buffer.from(actual);
  return left.length === right.length && timingSafeEqual(left, right);
}
