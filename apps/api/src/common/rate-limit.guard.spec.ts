import { HttpException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { RedisService } from './redis.service';
import { RateLimit, RateLimitGuard, type RateLimitOptions } from './rate-limit.guard';

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

function guardWith(options: RateLimitOptions | RateLimitOptions[] | undefined): RateLimitGuard {
  const reflector = new Reflector();
  vi.spyOn(reflector, 'getAllAndOverride').mockReturnValue(options);
  return new RateLimitGuard(reflector, redis);
}

async function clearCounters(): Promise<void> {
  const keys = await redis.client.keys(`ratelimit:${ROUTE}:*`);
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

class Dummy {
  // `this: void` : la méthode n'accède jamais à `this`, ce qui évite un faux
  // positif `unbound-method` quand on la référence sans l'appeler ci-dessous.
  @RateLimit({ limit: 1, windowSeconds: 60, by: 'ip' })
  handler(this: void): void {
    // Cible du décorateur : aucune logique, seule la métadonnée compte.
  }
}

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

  it('ne prolonge pas la fenetre a chaque appel', async () => {
    const guard = guardWith({ limit: 10, windowSeconds: 60, by: 'ip' });
    const key = `ratelimit:${ROUTE}:6.6.6.6`;

    expect(await guard.canActivate(contextFor('6.6.6.6', {}))).toBe(true);
    await redis.client.expire(key, 5);

    expect(await guard.canActivate(contextFor('6.6.6.6', {}))).toBe(true);
    const ttl = await redis.client.ttl(key);
    expect(ttl).toBeGreaterThan(0);
    expect(ttl).toBeLessThanOrEqual(5);
  });

  it('retombe sur anonyme sans email exploitable', async () => {
    const guard = guardWith({ limit: 10, windowSeconds: 60, by: 'ip+email' });
    const key = `ratelimit:${ROUTE}:5.5.5.5:anonyme`;

    expect(await guard.canActivate(contextFor('5.5.5.5', null))).toBe(true);
    expect(await guard.canActivate(contextFor('5.5.5.5', { email: 42 }))).toBe(true);

    expect(await redis.client.get(key)).toBe('2');
  });

  it('applique toutes les regles d_une liste', async () => {
    const guard = guardWith([
      { by: 'ip', limit: 1, windowSeconds: 60 },
      { by: 'ip+email', limit: 5, windowSeconds: 60 },
    ]);

    expect(await guard.canActivate(contextFor('7.7.7.7', { email: 'un@example.com' }))).toBe(true);
    await expect(
      guard.canActivate(contextFor('7.7.7.7', { email: 'deux@example.com' })),
    ).rejects.toThrowError(HttpException);
  });

  it('refuse en 503 quand redis est indisponible', async () => {
    const guard = guardWith({ limit: 10, windowSeconds: 60, by: 'ip' });
    vi.spyOn(redis.client, 'eval').mockRejectedValueOnce(new Error('ECONNREFUSED'));

    let caught: unknown;
    try {
      await guard.canActivate(contextFor('8.8.8.8', {}));
    } catch (error) {
      caught = error;
    }

    expect(caught).toBeInstanceOf(HttpException);
    const httpError = caught as HttpException;
    expect(httpError.getStatus()).toBe(503);
    expect(httpError.getResponse()).toMatchObject({ code: 'SERVICE_UNAVAILABLE' });
  });

  it('le decorateur est lu par un vrai Reflector', async () => {
    const reflector = new Reflector();
    const guard = new RateLimitGuard(reflector, redis);
    const context = {
      switchToHttp: () => ({ getRequest: () => ({ ip: '9.9.9.9', body: {}, routeOptions: { url: ROUTE } }) }),
      getHandler: () => Dummy.prototype.handler,
      getClass: () => Dummy,
    } as unknown as Parameters<RateLimitGuard['canActivate']>[0];

    expect(await guard.canActivate(context)).toBe(true);
    await expect(guard.canActivate(context)).rejects.toThrowError(HttpException);
  });
});
