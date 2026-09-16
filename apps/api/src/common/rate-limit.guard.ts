import {
  type CanActivate,
  type ExecutionContext,
  HttpException,
  HttpStatus,
  Injectable,
  Logger,
  SetMetadata,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import type { FastifyRequest } from 'fastify';
import { RedisService } from './redis.service';
import { serviceUnavailable } from './service-unavailable';

export const RATE_LIMIT_KEY = 'rateLimit';

export interface RateLimitOptions {
  limit: number;
  windowSeconds: number;
  /** `ip+email` protège un compte précis du bourrage d'identifiants. */
  by: 'ip' | 'ip+email';
}

/**
 * Limite une route : `@RateLimit({ limit: 5, windowSeconds: 900, by: 'ip+email' })`.
 * Accepte aussi un tableau pour cumuler plusieurs règles (ex. IP large + IP+email fin).
 */
export const RateLimit = (options: RateLimitOptions | RateLimitOptions[]) =>
  SetMetadata(RATE_LIMIT_KEY, options);

const EMAIL_MAX_LENGTH = 254;

/**
 * Clé Redis d'un compteur de débit. Exportée pour que tout code qui doit réinitialiser
 * un compteur (ex. après une connexion réussie) construise exactement la même clé que
 * cette garde, sans jamais pouvoir diverger.
 */
export function rateLimitKey(route: string, identity: string): string {
  return `ratelimit:${route}:${identity}`;
}

/** Identité `ip+email` : email normalisé (minuscules, sans espaces) comme au moment du comptage. */
export function ipEmailIdentity(ip: string, email: string): string {
  return `${ip}:${email.trim().toLowerCase().slice(0, EMAIL_MAX_LENGTH)}`;
}

// INCR et EXPIRE dans un même script : pas de compteur éternel si le processus
// meurt entre les deux, pas de fenêtre prolongée par deux premiers appels concurrents
// (contrairement à un INCR puis un EXPIRE conditionnel séparés, non atomiques).
const INCREMENT_SCRIPT = `
local count = redis.call('INCR', KEYS[1])
if count == 1 then redis.call('EXPIRE', KEYS[1], ARGV[1]) end
return count
`;

@Injectable()
export class RateLimitGuard implements CanActivate {
  private readonly logger = new Logger(RateLimitGuard.name);

  constructor(
    private readonly reflector: Reflector,
    private readonly redis: RedisService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const configured = this.reflector.getAllAndOverride<
      RateLimitOptions | RateLimitOptions[] | undefined
    >(RATE_LIMIT_KEY, [context.getHandler(), context.getClass()]);
    if (!configured) return true;

    const rules = Array.isArray(configured) ? configured : [configured];
    const request = context.switchToHttp().getRequest<FastifyRequest>();
    const route = request.routeOptions.url ?? 'inconnue';

    for (const options of rules) {
      await this.enforce(request, route, options);
    }
    return true;
  }

  private async enforce(
    request: FastifyRequest,
    route: string,
    options: RateLimitOptions,
  ): Promise<void> {
    const identity = this.identity(request, options);
    const key = rateLimitKey(route, identity);

    let count: unknown;
    try {
      count = await this.redis.client.eval(INCREMENT_SCRIPT, 1, key, options.windowSeconds);
    } catch (error) {
      this.logger.error(
        `Compteur de débit indisponible pour ${route} ${identity} : ${(error as Error).message}`,
      );
      throw serviceUnavailable();
    }
    if (typeof count !== 'number') {
      // Réponse Redis inattendue : on ne sait pas si la limite est respectée.
      this.logger.error(`Réponse Redis inattendue pour ${route} ${identity} : ${String(count)}`);
      throw serviceUnavailable();
    }

    if (count > options.limit) {
      // Choix délibéré : le limiteur est le rempart anti-bourrage d'identifiants,
      // toute action bloquée mérite une trace exploitable.
      this.logger.warn(`Débit dépassé : ${route} ${identity}`);
      throw new HttpException(
        { code: 'RATE_LIMITED', message: 'Trop de tentatives. Réessayez dans quelques minutes.' },
        HttpStatus.TOO_MANY_REQUESTS,
      );
    }
  }

  private identity(request: FastifyRequest, options: RateLimitOptions): string {
    if (options.by === 'ip') return request.ip;

    // La garde s'exécute avant la validation : le corps est brut, peut-être absent.
    const body = request.body as { email?: unknown } | null | undefined;
    const raw = body && typeof body === 'object' ? body.email : undefined;
    return ipEmailIdentity(request.ip, typeof raw === 'string' ? raw : 'anonyme');
  }
}
