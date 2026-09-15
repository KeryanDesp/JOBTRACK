import { HttpException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { RedisService } from './redis.service';
import { RATE_LIMIT_KEY, RateLimitGuard, type RateLimitOptions } from './rate-limit.guard';

const redis = new RedisService();
// Préfixe par processus : deux workers vitest ne doivent pas partager les compteurs.
const ROUTE = `/test-${process.pid}/auth/login`;

function contextFor(ip: string, body: unknown) {
  return {
    switchToHttp: () => ({ getRequest: () => ({ ip, body, routeOptions: { url: ROUTE } }) }),
    getHandler: () => ({}),
    getClass: () => ({}),
  } as unknown as Parameters<RateLimitGuard['canActivate']>[0];
}

function guardWith(options: RateLimitOptions | undefined): RateLimitGuard {
  const reflector = new Reflector();
  vi.spyOn(reflector, 'getAllAndOverride').mockReturnValue(options);
  return new RateLimitGuard(reflector, redis);
}

async function clearCounters(): Promise<void> {
  const keys = await redis.client.keys(`ratelimit:${ROUTE}:*`);
  if (keys.length > 0) await redis.client.del(...keys);
}

beforeEach(clearCounters);

afterAll(async () => {
  await clearCounters();
  await redis.onModuleDestroy();
});

describe('RateLimitGuard', () => {
  it('laisse passer sans configuration', async () => {
    expect(await guardWith(undefined).canActivate(contextFor('1.1.1.1', {}))).toBe(true);
  });

  it('bloque au-dela de la limite et renvoie un message francais', async () => {
    const guard = guardWith({ limit: 2, windowSeconds: 60, by: 'ip+email' });
    const context = contextFor('2.2.2.2', { email: ' A@B.com ' });

    expect(await guard.canActivate(context)).toBe(true);
    expect(await guard.canActivate(context)).toBe(true);

    await expect(guard.canActivate(context)).rejects.toThrowError(HttpException);
    await expect(guard.canActivate(context)).rejects.toThrowError(
      'Trop de tentatives. Réessayez dans quelques minutes.',
    );
    // La clé est normalisée (minuscules, sans espaces) et porte une expiration.
    const ttl = await redis.client.ttl(`ratelimit:${ROUTE}:2.2.2.2:a@b.com`);
    expect(ttl).toBeGreaterThan(0);
    expect(ttl).toBeLessThanOrEqual(60);
  });

  it('compte separement deux adresses ip', async () => {
    const guard = guardWith({ limit: 1, windowSeconds: 60, by: 'ip' });

    expect(await guard.canActivate(contextFor('3.3.3.3', {}))).toBe(true);
    expect(await guard.canActivate(contextFor('4.4.4.4', {}))).toBe(true);
  });

  it('expose la cle de metadonnee attendue par le decorateur', () => {
    expect(RATE_LIMIT_KEY).toBe('rateLimit');
  });
});
