import { createHmac } from 'node:crypto';
import { env } from '../../config/env';

// Clé dérivée du secret de session, dédiée aux handles : séparation des usages d'un même
// secret (même principe que CSRF_KEY dans csrf.guard.ts) — la clé qui signe le cookie
// (@fastify/cookie) n'est jamais celle qui dérive ce handle.
const HANDLE_KEY = createHmac('sha256', env.SESSION_SECRET).update('session-handle').digest();

/** Même forme qu'un identifiant de session (32 octets en base64url, sans remplissage). */
export const SESSION_HANDLE_PATTERN = /^[A-Za-z0-9_-]{43}$/;

/**
 * Identifiant opaque exposé au client à la place de l'identifiant de session brut :
 * jamais l'identifiant brut, c'est la valeur du cookie httpOnly `jt_session` — une fuite
 * XSS de `GET /auth/sessions` ne doit jamais livrer un jeton de session exploitable.
 */
export function sessionHandle(id: string): string {
  return createHmac('sha256', HANDLE_KEY).update(id).digest('base64url');
}
