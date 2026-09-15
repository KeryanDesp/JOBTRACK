import '@fastify/cookie'; // augmente FastifyRequest de `cookies`
import { timingSafeEqual } from 'node:crypto';
import { type CanActivate, type ExecutionContext, ForbiddenException, Injectable } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import type { FastifyRequest } from 'fastify';
import { IS_PUBLIC_KEY } from './decorators/public.decorator';

export const CSRF_COOKIE = 'jt_csrf';
export const CSRF_HEADER = 'x-csrf-token';

const MUTATING = new Set(['POST', 'PATCH', 'PUT', 'DELETE']);

/**
 * Double soumission : le cookie CSRF est lisible en JavaScript, le cookie de session ne l'est pas.
 * Un site tiers peut forcer l'envoi du cookie de session, mais pas lire le cookie CSRF
 * pour en recopier la valeur dans l'en-tête. Les routes publiques (connexion, inscription)
 * sont exemptées : elles n'agissent pas au nom d'une session existante.
 */
@Injectable()
export class CsrfGuard implements CanActivate {
  constructor(private readonly reflector: Reflector) {}

  canActivate(context: ExecutionContext): boolean {
    const isPublic = this.reflector.getAllAndOverride<boolean>(IS_PUBLIC_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (isPublic) return true;

    const request = context.switchToHttp().getRequest<FastifyRequest>();
    if (!MUTATING.has(request.method)) return true;

    const cookie = request.cookies?.[CSRF_COOKIE];
    const header = request.headers[CSRF_HEADER];

    if (!cookie || typeof header !== 'string' || !sameToken(cookie, header)) {
      throw new ForbiddenException({
        code: 'CSRF_MISMATCH',
        message: 'Requête refusée. Rechargez la page et réessayez.',
      });
    }
    return true;
  }
}

/** Comparaison en temps constant ; longueurs différentes → faux sans lever. */
function sameToken(a: string, b: string): boolean {
  const left = Buffer.from(a);
  const right = Buffer.from(b);
  return left.length === right.length && timingSafeEqual(left, right);
}
