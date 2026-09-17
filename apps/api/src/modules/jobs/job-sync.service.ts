import { randomUUID } from 'node:crypto';
import { Inject, Injectable, Logger } from '@nestjs/common';
import type { JobSyncStatus, Prisma } from '@prisma/client';
import type { ContractType, JobSearchQuery, JobSyncInfoDto } from '@jobtrack/shared';
import { PrismaService } from '../../common/prisma.service';
import { RedisService } from '../../common/redis.service';
import { JobIngestionService } from './job-ingestion.service';
import { buildCanonicalQuery, computeQueryHash, type QueryHashInput } from './lib/query-hash';
import { mapFranceTravailOffer } from './sources/france-travail/france-travail.mapper';
import { JOB_SOURCE_CONNECTORS, type JobSourceConnector } from './sources/job-source.connector';
import { JobSourceError, SourceNotConfiguredError } from './sources/source.errors';
import type { JobDraft } from './lib/job-draft';

const SYNC_CACHE_PREFIX = 'jobs:sync:';
const SYNC_LOCK_PREFIX = 'jobs:sync:lock:';
const SYNC_CACHE_TTL_SECONDS = 15 * 60;
const SYNC_LOCK_TTL_MS = 60_000;
const SEARCH_PUBLISHED_WITHIN_DAYS = 31;
const SEARCH_MAX_PAGES = 2;
const MAX_COMMUNES_PER_SYNC = 3;

const NOT_CONFIGURED_MESSAGE = "Le connecteur France Travail n'est pas configuré.";
const DEGRADED_MESSAGE = 'France Travail ne répond pas : résultats en cache.';
const SYNC_IN_PROGRESS_MESSAGE = 'Actualisation déjà en cours.';

/** Compare-and-delete : ne libère le verrou que si nous en sommes toujours le propriétaire (`ARGV[1]`). */
const UNLOCK_SCRIPT = `
if redis.call('GET', KEYS[1]) == ARGV[1] then
  return redis.call('DEL', KEYS[1])
end
return 0
`;

/** Compare-and-touch : ne prolonge le verrou que si nous en sommes toujours le propriétaire. */
const REFRESH_LOCK_SCRIPT = `
if redis.call('GET', KEYS[1]) == ARGV[1] then
  return redis.call('PEXPIRE', KEYS[1], ARGV[2])
end
return 0
`;

type LockResult = { status: 'acquired'; token: string } | { status: 'held' } | { status: 'unavailable' };

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

  /** Codes France Travail déjà mappés, jamais l'énumération locale — cf. `lib/query-hash.ts`. */
  private toQueryHashInput(query: JobSearchQuery): QueryHashInput {
    return {
      q: query.q,
      communes: query.communes,
      distance: query.distance,
      contractCodes: mapContractTypesToFranceTravail(query.contractTypes),
    };
  }

  computeQueryHash(query: JobSearchQuery): string {
    return computeQueryHash(this.toQueryHashInput(query));
  }

  async ensureFresh(
    query: JobSearchQuery,
    options: { force?: boolean; allowSync?: () => Promise<boolean> } = {},
  ): Promise<JobSyncInfoDto> {
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

    // Budget de synchronisation implicite (revue sécurité) : sans lui, une suite de
    // recherches distinctes (une valeur de `q` différente à chaque appel) déclenche une
    // vraie synchronisation à chaque fois, sans jamais passer par le budget explicite de
    // `refresh` — un moyen de contourner ce dernier. Vérifié après le cache (une recherche
    // déjà en cache ne consomme jamais ce budget) et avant le verrou (jamais de verrou pris
    // pour une synchronisation qui n'aura pas lieu).
    if (options.allowSync) {
      const allowed = await options.allowSync();
      if (!allowed) {
        const existing = await this.prisma.jobSearchSync.findUnique({ where: { queryHash: hash } });
        return {
          status: 'cached',
          syncedAt: existing?.lastSyncedAt.toISOString() ?? null,
          message: 'Trop de recherches distinctes : résultats en cache.',
        };
      }
    }

    const lock = await this.acquireLock(lockKey);
    if (lock.status === 'held') {
      // Une synchronisation pour la même recherche est déjà en cours ailleurs : on ne la
      // double jamais. Sans synchronisation antérieure, il n'y a encore rien à servir de
      // « frais » — jamais `ok`, qui laisserait croire à un résultat garanti à jour.
      const existing = await this.prisma.jobSearchSync.findUnique({ where: { queryHash: hash } });
      return {
        status: 'cached',
        syncedAt: existing?.lastSyncedAt.toISOString() ?? null,
        message: SYNC_IN_PROGRESS_MESSAGE,
      };
    }

    const token = lock.status === 'acquired' ? lock.token : null;
    try {
      return await this.runSync(connector, query, hash, cacheKey, lockKey, token);
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
      if (token) await this.releaseLock(lockKey, token);
    }
  }

  private async runSync(
    connector: JobSourceConnector,
    query: JobSearchQuery,
    hash: string,
    cacheKey: string,
    lockKey: string,
    token: string | null,
  ): Promise<JobSyncInfoDto> {
    const now = new Date();
    // Garde locale : le contrat partagé borne déjà `communes` à 3, mais un appelant
    // interne (hors validation Zod) ne doit jamais pouvoir déclencher plus d'appels.
    const communeCodes: (string | undefined)[] =
      query.communes.length > 0 ? query.communes.slice(0, MAX_COMMUNES_PER_SYNC) : [undefined];
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
        // Seule une panne de la source (auth, indisponibilité, débit) reste locale à
        // cette commune ; toute autre erreur (bug, panne Prisma déjà propagée par
        // l'ingestion…) doit remonter jusqu'à l'appelant, jamais être avalée ici.
        if (!(error instanceof JobSourceError)) throw error;
        failureCount += 1;
        lastErrorName = error.constructor.name;
        this.logger.warn(
          `Synchronisation France Travail échouée pour la commune ${communeCode ?? 'national'} : ${lastErrorName}`,
        );
      }

      if (token) await this.refreshLock(lockKey, token);
    }

    const lastStatus: JobSyncStatus = failureCount === 0 ? 'OK' : successCount === 0 ? 'FAILED' : 'PARTIAL';
    const lastError = lastStatus === 'OK' ? null : `${lastErrorName ?? 'Erreur'} : France Travail ne répond pas correctement.`;
    // `CanonicalQuery` est conforme à `Prisma.InputJsonValue` en pratique (chaînes,
    // tableaux de chaînes, nombre ou null) mais n'a pas de signature d'index — la seule
    // différence que `InputJsonObject` réclame, d'où le détour par `unknown`.
    const canonicalQuery = buildCanonicalQuery(this.toQueryHashInput(query)) as unknown as Prisma.InputJsonValue;

    await this.prisma.jobSearchSync.upsert({
      where: { queryHash: hash },
      create: {
        queryHash: hash,
        queryJson: canonicalQuery,
        lastSyncedAt: now,
        lastStatus,
        lastError,
        resultCount,
      },
      update: {
        queryJson: canonicalQuery,
        lastSyncedAt: now,
        lastStatus,
        lastError,
        resultCount,
      },
    });

    const degraded = lastStatus === 'FAILED' || (lastStatus === 'PARTIAL' && resultCount === 0);
    // Un résultat dégradé ne doit jamais être servi comme « frais » aux 15 prochaines
    // minutes : seul un succès (total ou partiel mais utile) alimente le cache.
    if (!degraded) {
      await this.safeRedisSetEx(cacheKey, now.toISOString(), SYNC_CACHE_TTL_SECONDS);
    }

    return {
      status: degraded ? 'degraded' : 'ok',
      syncedAt: now.toISOString(),
      message: degraded ? DEGRADED_MESSAGE : null,
    };
  }

  /** `SET NX PX` avec un jeton propre à cet appel : seul son détenteur pourra le libérer ou le prolonger. */
  private async acquireLock(key: string): Promise<LockResult> {
    const token = randomUUID();
    try {
      const result = await this.redis.client.set(key, token, 'PX', SYNC_LOCK_TTL_MS, 'NX');
      return result === 'OK' ? { status: 'acquired', token } : { status: 'held' };
    } catch (error) {
      // Redis indisponible : on ne bloque jamais la synchronisation pour autant (spec
      // §5) — mais sans verrou réel, personne ne le détient : `unavailable`, jamais
      // `acquired` avec un jeton qui ne protégerait rien.
      this.logger.warn(`Verrou de synchronisation indisponible (Redis) : ${(error as Error).message}`);
      return { status: 'unavailable' };
    }
  }

  private async releaseLock(key: string, token: string): Promise<void> {
    try {
      await this.redis.client.eval(UNLOCK_SCRIPT, 1, key, token);
    } catch (error) {
      this.logger.warn(`Libération du verrou de synchronisation impossible : ${(error as Error).message}`);
    }
  }

  /** Prolonge le verrou entre deux communes : une synchronisation à 3 communes ne doit jamais dépasser son TTL. */
  private async refreshLock(key: string, token: string): Promise<void> {
    try {
      await this.redis.client.eval(REFRESH_LOCK_SCRIPT, 1, key, token, SYNC_LOCK_TTL_MS);
    } catch (error) {
      this.logger.warn(`Prolongation du verrou de synchronisation impossible : ${(error as Error).message}`);
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
