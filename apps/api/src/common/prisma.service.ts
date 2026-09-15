import { Injectable, type OnModuleDestroy, type OnModuleInit } from '@nestjs/common';
import { PrismaClient } from '@prisma/client';
import { withTimeout } from './with-timeout';

const HEALTH_TIMEOUT_MS = 1500;

@Injectable()
export class PrismaService extends PrismaClient implements OnModuleInit, OnModuleDestroy {
  async onModuleInit(): Promise<void> {
    await this.$connect();
  }

  async onModuleDestroy(): Promise<void> {
    await this.$disconnect();
  }

  /** Renvoie true si Postgres répond en moins de 1,5 s. Utilisé par la sonde /health. */
  async isReachable(): Promise<boolean> {
    try {
      await withTimeout(this.$queryRaw`SELECT 1`, HEALTH_TIMEOUT_MS, 'Postgres');
      return true;
    } catch {
      return false;
    }
  }
}
