import '@fastify/cookie'; // augmente FastifyReply de `setCookie`/`clearCookie`
import type { FastifyReply } from 'fastify';
import { CSRF_COOKIE, csrfTokenFor } from '../../common/csrf.guard';
import { env } from '../../config/env';
import { SESSION_TTL_SECONDS } from './session.service';

// Défini ici (et pas dans auth.guard.ts) : auth.guard a besoin d'importer setAuthCookies
// depuis ce module pour renouveler les cookies, et cookies → guard créerait un cycle.
export const SESSION_COOKIE = 'jt_session';

// `SameSite=Lax` (défaut) exige que l'API et le SPA partagent le même domaine enregistrable
// (localhost ↔ localhost, app.jobtrack.fr ↔ api.jobtrack.fr). Sur deux domaines distincts, le
// navigateur laisserait tomber le cookie de session silencieusement : `COOKIE_SAMESITE=none`
// est là pour ce cas (voir la documentation du champ dans `@jobtrack/shared`, env.ts).
//
// `Secure` dès que `SameSite=None`, et pas seulement en production : un cookie `SameSite=None`
// sans `Secure` est rejeté par les navigateurs, et la panne serait la même que celle qu'on
// cherche à corriger.
const BASE = {
  sameSite: env.COOKIE_SAMESITE,
  secure: env.COOKIE_SAMESITE === 'none' || env.NODE_ENV === 'production',
  path: '/',
} as const;

/** Pose le cookie de session (signé, httpOnly) et le jeton CSRF (lisible en JavaScript). */
export function setAuthCookies(reply: FastifyReply, sessionId: string): void {
  reply.setCookie(SESSION_COOKIE, sessionId, {
    ...BASE,
    httpOnly: true, // inaccessible au JavaScript : immunise contre le vol par XSS
    signed: true,
    maxAge: SESSION_TTL_SECONDS, // même durée que la session Redis
  });

  // Volontairement lisible en JavaScript : le frontend doit le recopier en en-tête.
  // Dérivé de la session : un cookie déposé par un tiers ne correspond à aucune session.
  reply.setCookie(CSRF_COOKIE, csrfTokenFor(sessionId), {
    ...BASE,
    httpOnly: false,
    maxAge: SESSION_TTL_SECONDS,
  });
}

export function clearAuthCookies(reply: FastifyReply): void {
  reply.clearCookie(SESSION_COOKIE, BASE);
  reply.clearCookie(CSRF_COOKIE, BASE);
}

/** Cookie éphémère portant le `state` du flux OAuth Google, entre `/auth/google` et son callback. */
export const OAUTH_STATE_COOKIE = 'jt_oauth_state';

export const OAUTH_STATE_OPTIONS = { ...BASE, httpOnly: true } as const;
