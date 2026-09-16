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
import type { AuthenticatedRequest } from '../modules/auth/auth.guard';
import { RateLimiterService } from './rate-limiter.service';

export const USER_RATE_LIMIT_KEY = 'userRateLimit';

export interface UserRateLimitOptions {
  limit: number;
  windowSeconds: number;
}

/**
 * Limite une route par utilisateur authentifié : `@UserRateLimit({ limit: 3, windowSeconds: 3600 })`.
 * Garde **locale** (posée avec `@UseGuards(UserRateLimitGuard)` sur la route) : elle s'exécute
 * après la garde globale d'authentification, donc `request.user` est déjà renseigné.
 */
export const UserRateLimit = (options: UserRateLimitOptions) =>
  SetMetadata(USER_RATE_LIMIT_KEY, options);

/** Même compteur, même 503 de repli que `RateLimitGuard`, mais une clé par utilisateur plutôt que par IP. */
@Injectable()
export class UserRateLimitGuard implements CanActivate {
  private readonly logger = new Logger(UserRateLimitGuard.name);

  constructor(
    private readonly reflector: Reflector,
    private readonly limiter: RateLimiterService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const options = this.reflector.getAllAndOverride<UserRateLimitOptions | undefined>(
      USER_RATE_LIMIT_KEY,
      [context.getHandler(), context.getClass()],
    );
    if (!options) return true;

    const request = context.switchToHttp().getRequest<AuthenticatedRequest>();
    const route = request.routeOptions.url ?? 'inconnue';
    const key = `ratelimit:${route}:user:${request.user.id}`;

    const { allowed } = await this.limiter.hit(key, options.limit, options.windowSeconds);
    if (!allowed) {
      this.logger.warn(`Débit dépassé : ${route} user:${request.user.id}`);
      throw new HttpException(
        { code: 'RATE_LIMITED', message: 'Trop de tentatives. Réessayez dans quelques minutes.' },
        HttpStatus.TOO_MANY_REQUESTS,
      );
    }
    return true;
  }
}
