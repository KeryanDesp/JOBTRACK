import { Injectable, Logger, type OnModuleDestroy, type OnModuleInit } from '@nestjs/common';
import Redis from 'ioredis';
import { env } from '../config/env';
import { withTimeout } from './with-timeout';

const HEALTH_TIMEOUT_MS = 1500;

@Injectable()
export class RedisService implements OnModuleInit, OnModuleDestroy {
  readonly client: Redis;

  private readonly logger = new Logger(RedisService.name);

  constructor() {
    this.client = new Redis(env.REDIS_URL, {
      maxRetriesPerRequest: 2,
      lazyConnect: true,
      // Borne l'attente au démarrage : sans cela, un Redis qui absorbe les
      // paquets retarderait onModuleInit de 10 s (délai par défaut d'ioredis).
      connectTimeout: 2000,
    });

    // Sans écouteur, ioredis écrit chaque erreur de connexion sur la console.
    // Niveau warn : une reconnexion transitoire est attendue, et isReachable()
    // rapporte déjà l'état réel de la dépendance.
    this.client.on('error', (error: Error) => {
      this.logger.warn(`Redis : ${error.message}`);
    });
  }

  async onModuleInit(): Promise<void> {
    // Une connexion refusée au démarrage ne doit pas empêcher l'API de répondre :
    // la sonde /health rapportera Redis comme indisponible.
    try {
      await this.client.connect();
    } catch (error) {
      this.logger.warn(`Redis injoignable au démarrage : ${(error as Error).message}`);
    }
  }

  async onModuleDestroy(): Promise<void> {
    await this.client.quit();
  }

  /** Renvoie true si Redis répond au PING en moins de 1,5 s. Utilisé par la sonde /health. */
  async isReachable(): Promise<boolean> {
    try {
      return (await withTimeout(this.client.ping(), HEALTH_TIMEOUT_MS, 'Redis')) === 'PONG';
    } catch {
      return false;
    }
  }
}
