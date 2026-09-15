import {
  type CanActivate,
  type ExecutionContext,
  HttpException,
  HttpStatus,
  Injectable,
  SetMetadata,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import type { FastifyRequest } from 'fastify';
import { RedisService } from './redis.service';

export const RATE_LIMIT_KEY = 'rateLimit';

export interface RateLimitOptions {
  limit: number;
  windowSeconds: number;
  /** `ip+email` protège un compte précis du bourrage d'identifiants. */
  by: 'ip' | 'ip+email';
}

/** Limite une route : `@RateLimit({ limit: 5, windowSeconds: 900, by: 'ip+email' })`. */
export const RateLimit = (options: RateLimitOptions) => SetMetadata(RATE_LIMIT_KEY, options);

const EMAIL_MAX_LENGTH = 254;

@Injectable()
export class RateLimitGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly redis: RedisService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const options = this.reflector.getAllAndOverride<RateLimitOptions | undefined>(RATE_LIMIT_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (!options) return true;

    const request = context.switchToHttp().getRequest<FastifyRequest>();
    const route = request.routeOptions.url ?? 'inconnue';
    const key = `ratelimit:${route}:${this.identity(request, options)}`;

    // INCR et TTL dans une même transaction : si la clé n'a pas d'expiration
    // (première requête, ou EXPIRE perdu lors d'un arrêt), on la pose. Un INCR
    // suivi d'un EXPIRE non atomique laisserait un compteur éternel après un crash.
    const results = await this.redis.client.multi().incr(key).ttl(key).exec();
    const count = resultAt(results, 0);
    const ttl = resultAt(results, 1);
    if (ttl < 0) await this.redis.client.expire(key, options.windowSeconds);

    if (count > options.limit) {
      throw new HttpException(
        { code: 'RATE_LIMITED', message: 'Trop de tentatives. Réessayez dans quelques minutes.' },
        HttpStatus.TOO_MANY_REQUESTS,
      );
    }
    return true;
  }

  private identity(request: FastifyRequest, options: RateLimitOptions): string {
    if (options.by === 'ip') return request.ip;

    // La garde s'exécute avant la validation : le corps est brut, peut-être absent.
    const body = request.body as { email?: unknown } | null | undefined;
    const raw = body && typeof body === 'object' ? body.email : undefined;
    const email =
      typeof raw === 'string' ? raw.trim().toLowerCase().slice(0, EMAIL_MAX_LENGTH) : 'anonyme';

    return `${request.ip}:${email}`;
  }
}

/** Lit le résultat numérique d'une commande dans une transaction `multi().exec()`. */
function resultAt(results: [Error | null, unknown][] | null, index: number): number {
  const entry = results?.[index];
  if (!entry || entry[0] || typeof entry[1] !== 'number') return 0;
  return entry[1];
}
