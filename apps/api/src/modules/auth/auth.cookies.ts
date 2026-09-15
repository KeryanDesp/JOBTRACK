import '@fastify/cookie'; // augmente FastifyReply de `setCookie`/`clearCookie`
import type { FastifyReply } from 'fastify';
import { CSRF_COOKIE, csrfTokenFor } from '../../common/csrf.guard';
import { env } from '../../config/env';
import { SESSION_COOKIE } from './auth.guard';
import { SESSION_TTL_SECONDS } from './session.service';

/** Pose le cookie de session (signé, httpOnly) et le jeton CSRF (lisible en JavaScript). */
export function setAuthCookies(reply: FastifyReply, sessionId: string): void {
  const secure = env.NODE_ENV === 'production';

  reply.setCookie(SESSION_COOKIE, sessionId, {
    httpOnly: true, // inaccessible au JavaScript : immunise contre le vol par XSS
    secure,
    sameSite: 'lax',
    signed: true,
    path: '/',
    maxAge: SESSION_TTL_SECONDS, // même durée que la session Redis
  });

  // Volontairement lisible en JavaScript : le frontend doit le recopier en en-tête.
  // Dérivé de la session : un cookie déposé par un tiers ne correspond à aucune session.
  reply.setCookie(CSRF_COOKIE, csrfTokenFor(sessionId), {
    httpOnly: false,
    secure,
    sameSite: 'lax',
    path: '/',
    maxAge: SESSION_TTL_SECONDS,
  });
}

export function clearAuthCookies(reply: FastifyReply): void {
  reply.clearCookie(SESSION_COOKIE, { path: '/' });
  reply.clearCookie(CSRF_COOKIE, { path: '/' });
}
