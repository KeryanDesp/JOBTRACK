import { Injectable, type OnModuleDestroy } from '@nestjs/common';
import Redis from 'ioredis';
import { env } from '../config/env';

@Injectable()
export class RedisService implements OnModuleDestroy {
  readonly client: Redis;

  constructor() {
    this.client = new Redis(env.REDIS_URL, { maxRetriesPerRequest: 2 });
  }

  async onModuleDestroy(): Promise<void> {
    await this.client.quit();
  }

  /** Renvoie true si Redis répond au PING. Utilisé par la sonde /health. */
  async isReachable(): Promise<boolean> {
    try {
      return (await this.client.ping()) === 'PONG';
    } catch {
      return false;
    }
  }
}
