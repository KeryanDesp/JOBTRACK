import { describe, expect, it, vi } from 'vitest';
import type { PrismaService } from '../../common/prisma.service';
import type { RedisService } from '../../common/redis.service';
import { HealthService } from './health.service';

function build(databaseUp: boolean, redisUp: boolean): HealthService {
  const prisma = { isReachable: vi.fn().mockResolvedValue(databaseUp) } as unknown as PrismaService;
  const redis = { isReachable: vi.fn().mockResolvedValue(redisUp) } as unknown as RedisService;
  return new HealthService(prisma, redis);
}

describe('HealthService', () => {
  it('rapporte ok quand postgres et redis repondent', async () => {
    const result = await build(true, true).check();
    expect(result.status).toBe('ok');
    expect(result.services).toEqual({ database: 'up', redis: 'up' });
  });

  it('rapporte degraded quand postgres ne repond pas', async () => {
    const result = await build(false, true).check();
    expect(result.status).toBe('degraded');
    expect(result.services.database).toBe('down');
  });

  it('rapporte degraded quand redis ne repond pas', async () => {
    const result = await build(true, false).check();
    expect(result.status).toBe('degraded');
    expect(result.services.redis).toBe('down');
  });
});
