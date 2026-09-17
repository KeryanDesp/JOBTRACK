import { Logger, type Provider } from '@nestjs/common';
import { RateLimiterService } from '../../../../common/rate-limiter.service';
import { RedisService } from '../../../../common/redis.service';
import { env } from '../../../../config/env';
import { JOB_SOURCE_CONNECTORS, type JobSourceConnector } from '../job-source.connector';
import { FranceTravailClient } from './france-travail.client';
import { FranceTravailConnector } from './france-travail.connector';

/**
 * Fournit la liste des connecteurs de sources configurés. France Travail est
 * absent de la liste (tableau vide) sans identifiants : le module démarre et
 * `/jobs` reste utilisable (spec §4 et §8), simplement sans offre réelle.
 */
export const jobSourceConnectorsProvider: Provider = {
  provide: JOB_SOURCE_CONNECTORS,
  useFactory: (redisService: RedisService, rateLimiter: RateLimiterService): JobSourceConnector[] => {
    if (!env.FRANCE_TRAVAIL_CLIENT_ID || !env.FRANCE_TRAVAIL_CLIENT_SECRET) return [];

    const client = new FranceTravailClient({
      clientId: env.FRANCE_TRAVAIL_CLIENT_ID,
      clientSecret: env.FRANCE_TRAVAIL_CLIENT_SECRET,
      apiUrl: env.FRANCE_TRAVAIL_API_URL,
      tokenUrl: env.FRANCE_TRAVAIL_TOKEN_URL,
      scope: env.FRANCE_TRAVAIL_SCOPE,
      redis: redisService.client,
      rateLimiter,
      logger: new Logger('FranceTravailClient'),
    });

    return [new FranceTravailConnector(client)];
  },
  inject: [RedisService, RateLimiterService],
};
