import { Inject, Injectable, Logger } from '@nestjs/common';
import type { JobSyncStatus } from '@prisma/client';
import type { ContractType, JobSearchQuery, JobSyncInfoDto } from '@jobtrack/shared';
import { PrismaService } from '../../common/prisma.service';
import { RedisService } from '../../common/redis.service';
import { JobIngestionService } from './job-ingestion.service';
import { computeQueryHash } from './lib/query-hash';
import { mapFranceTravailOffer } from './sources/france-travail/france-travail.mapper';
import { JOB_SOURCE_CONNECTORS, type JobSourceConnector } from './sources/job-source.connector';
import { SourceNotConfiguredError } from './sources/source.errors';
import type { JobDraft } from './lib/job-draft';

const SYNC_CACHE_PREFIX = 'jobs:sync:';
const SYNC_LOCK_PREFIX = 'jobs:sync:lock:';
const SYNC_CACHE_TTL_SECONDS = 15 * 60;
const SYNC_LOCK_TTL_MS = 30_000;
const SEARCH_PUBLISHED_WITHIN_DAYS = 31;
const SEARCH_MAX_PAGES = 2;

const NOT_CONFIGURED_MESSAGE = "Le connecteur France Travail n'est pas configuré.";
const DEGRADED_MESSAGE = 'France Travail ne répond pas : résultats en cache.';
const SYNC_IN_PROGRESS_MESSAGE = 'Actualisation déjà en cours.';

/**
 * `typeContrat`/`natureContrat` France Travail acceptés en recherche (spec §5) : un
 * type sans code connu (alternance, stage, temps partiel) n'est jamais envoyé à la
 * source — il reste un filtre purement local, appliqué en aval sur la base.
 */
const CONTRACT_TYPE_TO_FRANCE_TRAVAIL_CODES: Record<ContractType, string[]> = {
  CDI: ['CDI'],
  CDD: ['CDD', 'SAI'],
  INTERIM: ['MIS'],
  FREELANCE: ['LIB', 'FRA', 'CCE', 'REP'],
  APPRENTICESHIP: [],
  INTERNSHIP: [],
  PART_TIME: [],
};

/** `ContractType[]` (préférences locales) → codes `typeContrat` France Travail, dédoublonnés. */
export function mapContractTypesToFranceTravail(contractTypes: readonly ContractType[]): string[] {
  const codes = new Set<string>();
  for (const type of contractTypes) {
    for (const code of CONTRACT_TYPE_TO_FRANCE_TRAVAIL_CODES[type]) codes.add(code);
  }
  return [...codes];
}

/**
 * Service de synchronisation à la demande (spec §5, approche B) : une
 * recherche déclenche, si le cache Redis est périmé, un petit lot d'appels
 * France Travail (un par commune, ou un appel national), ingère les offres,
 * et se dégrade proprement (jamais d'exception) en cas de panne partielle ou
 * totale de la source.
 */
@Injectable()
export class JobSyncService {
  private readonly logger = new Logger(JobSyncService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly redis: RedisService,
    private readonly ingestion: JobIngestionService,
    @Inject(JOB_SOURCE_CONNECTORS) private readonly connectors: JobSourceConnector[],
  ) {}

  computeQueryHash(query: JobSearchQuery): string {
    return computeQueryHash(query);
  }

  async ensureFresh(query: JobSearchQuery, options: { force?: boolean } = {}): Promise<JobSyncInfoDto> {
    const connector = this.connectors.find((candidate) => candidate.kind === 'FRANCE_TRAVAIL');
    const hash = this.computeQueryHash(query);

    if (!connector) {
      const existing = await this.prisma.jobSearchSync.findUnique({ where: { queryHash: hash } });
      return {
        status: 'not_configured',
        syncedAt: existing?.lastSyncedAt.toISOString() ?? null,
        message: NOT_CONFIGURED_MESSAGE,
      };
    }

    const cacheKey = `${SYNC_CACHE_PREFIX}${hash}`;
    const lockKey = `${SYNC_LOCK_PREFIX}${hash}`;

    if (options.force) {
      await this.safeRedisDel(cacheKey);
    } else {
      const cached = await this.safeRedisGet(cacheKey);
      if (cached) return { status: 'cached', syncedAt: cached, message: null };
    }

    const lockAcquired = await this.safeAcquireLock(lockKey);
    if (!lockAcquired) {
      const existing = await this.prisma.jobSearchSync.findUnique({ where: { queryHash: hash } });
      return {
        status: existing ? 'cached' : 'ok',
        syncedAt: existing?.lastSyncedAt.toISOString() ?? null,
        message: SYNC_IN_PROGRESS_MESSAGE,
      };
    }

    try {
      return await this.runSync(connector, query, hash, cacheKey);
    } catch (error) {
      if (error instanceof SourceNotConfiguredError) {
        const existing = await this.prisma.jobSearchSync.findUnique({ where: { queryHash: hash } });
        return {
          status: 'not_configured',
          syncedAt: existing?.lastSyncedAt.toISOString() ?? null,
          message: NOT_CONFIGURED_MESSAGE,
        };
      }
      throw error;
    } finally {
      await this.safeRedisDel(lockKey);
    }
  }

  private async runSync(
    connector: JobSourceConnector,
    query: JobSearchQuery,
    hash: string,
    cacheKey: string,
  ): Promise<JobSyncInfoDto> {
    const now = new Date();
    const communeCodes: (string | undefined)[] = query.communes.length > 0 ? [...query.communes] : [undefined];
    const contractCodes = mapContractTypesToFranceTravail(query.contractTypes);
    const keywords = query.q.trim() === '' ? undefined : query.q;

    let successCount = 0;
    let failureCount = 0;
    let resultCount = 0;
    let lastErrorName: string | null = null;

    for (const communeCode of communeCodes) {
      try {
        const offers = await connector.search({
          keywords,
          communeCode,
          distanceKm: query.distance,
          contractCodes,
          publishedWithinDays: SEARCH_PUBLISHED_WITHIN_DAYS,
          maxPages: SEARCH_MAX_PAGES,
        });
        resultCount += offers.length;

        const drafts: JobDraft[] = [];
        for (const offer of offers) {
          const draft = mapFranceTravailOffer(offer.raw, now);
          if (draft) drafts.push(draft);
        }
        await this.ingestion.upsertMany(drafts, now);
        successCount += 1;
      } catch (error) {
        if (error instanceof SourceNotConfiguredError) throw error;
        failureCount += 1;
        lastErrorName = (error as Error).constructor.name;
        this.logger.warn(
          `Synchronisation France Travail échouée pour la commune ${communeCode ?? 'national'} : ${lastErrorName}`,
        );
      }
    }

    const lastStatus: JobSyncStatus = failureCount === 0 ? 'OK' : successCount === 0 ? 'FAILED' : 'PARTIAL';
    const lastError = lastStatus === 'OK' ? null : `${lastErrorName ?? 'Erreur'} : France Travail ne répond pas correctement.`;

    await this.prisma.jobSearchSync.upsert({
      where: { queryHash: hash },
      create: {
        queryHash: hash,
        queryJson: query,
        lastSyncedAt: now,
        lastStatus,
        lastError,
        resultCount,
      },
      update: {
        queryJson: query,
        lastSyncedAt: now,
        lastStatus,
        lastError,
        resultCount,
      },
    });

    const degraded = lastStatus === 'FAILED' || (lastStatus === 'PARTIAL' && resultCount === 0);
    if (lastStatus !== 'FAILED') {
      await this.safeRedisSetEx(cacheKey, now.toISOString(), SYNC_CACHE_TTL_SECONDS);
    }

    return {
      status: degraded ? 'degraded' : 'ok',
      syncedAt: now.toISOString(),
      message: degraded ? DEGRADED_MESSAGE : null,
    };
  }

  /** Verrou `SET NX PX` : jamais bloquant si Redis est indisponible (on considère le verrou acquis). */
  private async safeAcquireLock(key: string): Promise<boolean> {
    try {
      const result = await this.redis.client.set(key, '1', 'PX', SYNC_LOCK_TTL_MS, 'NX');
      return result === 'OK';
    } catch (error) {
      this.logger.warn(`Verrou de synchronisation indisponible (Redis) : ${(error as Error).message}`);
      return true;
    }
  }

  private async safeRedisGet(key: string): Promise<string | null> {
    try {
      return await this.redis.client.get(key);
    } catch (error) {
      this.logger.warn(`Cache de synchronisation indisponible (Redis) : ${(error as Error).message}`);
      return null;
    }
  }

  private async safeRedisSetEx(key: string, value: string, ttlSeconds: number): Promise<void> {
    try {
      await this.redis.client.set(key, value, 'EX', ttlSeconds);
    } catch (error) {
      this.logger.warn(`Écriture du cache de synchronisation impossible (Redis) : ${(error as Error).message}`);
    }
  }

  private async safeRedisDel(key: string): Promise<void> {
    try {
      await this.redis.client.del(key);
    } catch (error) {
      this.logger.warn(`Suppression de clé Redis impossible : ${(error as Error).message}`);
    }
  }
}
