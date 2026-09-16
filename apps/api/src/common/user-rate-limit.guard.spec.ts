import { HttpException, UnauthorizedException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { AuthenticatedRequest } from '../modules/auth/auth.guard';
import { RateLimiterService } from './rate-limiter.service';
import { RedisService } from './redis.service';
import { UserRateLimitGuard, type UserRateLimitOptions } from './user-rate-limit.guard';

const redis = new RedisService();
const limiter = new RateLimiterService(redis);
// Préfixe par processus : deux workers vitest ne doivent pas partager les compteurs.
const ROUTE = `/test-${process.pid}/cv-imports`;
const OTHER_ROUTE = `/test-${process.pid}/cv-imports/retry`;
const BUCKET = `cv-extraction-${process.pid}`;

function contextFor(userId: string | undefined, route: string = ROUTE) {
  const request = {
    routeOptions: { url: route },
    user: userId
      ? { id: userId, email: '', firstName: '', lastName: '', onboardingCompleted: true }
      : undefined,
  } as unknown as AuthenticatedRequest;

  return {
    switchToHttp: () => ({ getRequest: () => request }),
    getHandler: () => ({}),
    getClass: () => ({}),
  } as unknown as Parameters<UserRateLimitGuard['canActivate']>[0];
}

function guardWith(options: UserRateLimitOptions | undefined): UserRateLimitGuard {
  const reflector = new Reflector();
  vi.spyOn(reflector, 'getAllAndOverride').mockReturnValue(options);
  return new UserRateLimitGuard(reflector, limiter);
}

async function clearCounters(): Promise<void> {
  const keys = [
    ...(await redis.client.keys(`ratelimit:${ROUTE}:*`)),
    ...(await redis.client.keys(`ratelimit:${OTHER_ROUTE}:*`)),
    ...(await redis.client.keys(`ratelimit:${BUCKET}:*`)),
  ];
  if (keys.length > 0) await redis.client.del(...keys);
}

beforeEach(clearCounters);

afterEach(() => {
  vi.restoreAllMocks();
});

afterAll(async () => {
  await clearCounters();
  await redis.onModuleDestroy();
});

describe('UserRateLimitGuard', () => {
  it('laisse passer sous la limite', async () => {
    const guard = guardWith({ limit: 3, windowSeconds: 3600 });

    expect(await guard.canActivate(contextFor('user-1'))).toBe(true);
    expect(await guard.canActivate(contextFor('user-1'))).toBe(true);
    expect(await guard.canActivate(contextFor('user-1'))).toBe(true);
  });

  it('renvoie 429 au-dela de la limite', async () => {
    const guard = guardWith({ limit: 1, windowSeconds: 3600 });

    expect(await guard.canActivate(contextFor('user-2'))).toBe(true);
    await expect(guard.canActivate(contextFor('user-2'))).rejects.toThrowError(HttpException);

    let caught: unknown;
    try {
      await guard.canActivate(contextFor('user-2'));
    } catch (error) {
      caught = error;
    }
    expect(caught).toBeInstanceOf(HttpException);
    expect((caught as HttpException).getStatus()).toBe(429);
  });

  it('compte separement deux utilisateurs', async () => {
    const guard = guardWith({ limit: 1, windowSeconds: 3600 });

    expect(await guard.canActivate(contextFor('user-3'))).toBe(true);
    expect(await guard.canActivate(contextFor('user-4'))).toBe(true);
    await expect(guard.canActivate(contextFor('user-3'))).rejects.toThrowError(HttpException);
  });

  it('renvoie NOT_AUTHENTICATED plutot qu_une TypeError quand request.user est absent', async () => {
    const guard = guardWith({ limit: 3, windowSeconds: 3600 });

    await expect(guard.canActivate(contextFor(undefined))).rejects.toBeInstanceOf(
      UnauthorizedException,
    );

    let caught: unknown;
    try {
      await guard.canActivate(contextFor(undefined));
    } catch (error) {
      caught = error;
    }
    expect((caught as UnauthorizedException).getResponse()).toMatchObject({
      code: 'NOT_AUTHENTICATED',
    });
  });

  it('partage un seul budget entre deux routes portant le meme bucket', async () => {
    const guard = guardWith({ limit: 1, windowSeconds: 3600, bucket: BUCKET });

    // Deux routes distinctes, mais le meme bucket : la seconde route est deja bloquee par
    // le premier appel sur la premiere route (ex. upload puis retry d'un CV).
    expect(await guard.canActivate(contextFor('user-5', ROUTE))).toBe(true);
    await expect(guard.canActivate(contextFor('user-5', OTHER_ROUTE))).rejects.toThrowError(HttpException);
  });

  it('sans bucket, deux routes different comptent separement (comportement par defaut inchange)', async () => {
    const guard = guardWith({ limit: 1, windowSeconds: 3600 });

    expect(await guard.canActivate(contextFor('user-6', ROUTE))).toBe(true);
    expect(await guard.canActivate(contextFor('user-6', OTHER_ROUTE))).toBe(true);
  });
});
