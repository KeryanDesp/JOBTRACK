import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../common/prisma.service';
import { RedisService } from '../../common/redis.service';

export interface HealthReport {
  status: 'ok' | 'degraded';
  services: { database: 'up' | 'down'; redis: 'up' | 'down' };
  timestamp: string;
}

@Injectable()
export class HealthService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly redis: RedisService,
  ) {}

  async check(): Promise<HealthReport> {
    const [databaseUp, redisUp] = await Promise.all([
      this.prisma.isReachable(),
      this.redis.isReachable(),
    ]);

    return {
      status: databaseUp && redisUp ? 'ok' : 'degraded',
      services: {
        database: databaseUp ? 'up' : 'down',
        redis: redisUp ? 'up' : 'down',
      },
      timestamp: new Date().toISOString(),
    };
  }
}
