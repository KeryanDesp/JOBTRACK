import { afterAll, describe, expect, it } from 'vitest';
import { RedisService } from '../../common/redis.service';
import { PasswordResetService } from './password-reset.service';

const redis = new RedisService();
const service = new PasswordResetService(redis);
const USER_ID = `reset-user-${process.pid}`;

afterAll(async () => {
  await redis.onModuleDestroy();
});

describe('PasswordResetService', () => {
  it('emet un jeton consommable une seule fois', async () => {
    const token = await service.issue(USER_ID);

    expect(token).toMatch(/^[A-Za-z0-9_-]{43}$/); // 32 octets en base64url
    expect(await service.consume(token)).toBe(USER_ID);
    expect(await service.consume(token)).toBeNull();
  });

  it('renvoie null pour un jeton inconnu ou malforme', async () => {
    expect(await service.consume('jeton-invente')).toBeNull();
    expect(await service.consume('')).toBeNull();
  });

  it('ne stocke jamais le jeton en clair dans redis et pose une expiration', async () => {
    const token = await service.issue(USER_ID);
    try {
      expect(await redis.client.get(`pwreset:${token}`)).toBeNull();
      expect(await redis.client.get(PasswordResetService.keyFor(token))).toBe(USER_ID);

      const ttl = await redis.client.ttl(PasswordResetService.keyFor(token));
      expect(ttl).toBeGreaterThan(0);
      expect(ttl).toBeLessThanOrEqual(60 * 60);
    } finally {
      await service.consume(token);
    }
  });

  it('un nouveau jeton invalide le precedent pour le meme utilisateur', async () => {
    const first = await service.issue(USER_ID);
    const second = await service.issue(USER_ID);
    try {
      expect(await service.consume(first)).toBeNull();
      expect(await service.consume(second)).toBe(USER_ID);
    } finally {
      await service.consume(first);
      await service.consume(second);
    }
  });

  it('un seul appel simultane consomme le jeton', async () => {
    const token = await service.issue(USER_ID);
    try {
      const results = await Promise.all([service.consume(token), service.consume(token)]);
      expect(results.filter(Boolean)).toEqual([USER_ID]);
    } finally {
      await service.consume(token);
    }
  });

  it('deux emissions simultanees ne laissent qu_un jeton valide', async () => {
    const [first, second] = await Promise.all([service.issue(USER_ID), service.issue(USER_ID)]);
    try {
      const results = await Promise.all([service.consume(first), service.consume(second)]);
      expect(results.filter(Boolean)).toEqual([USER_ID]);
      expect(results.filter((result) => result === null)).toHaveLength(1);
    } finally {
      await service.consume(first);
      await service.consume(second);
    }
  });
});
