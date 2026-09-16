import { jobSearchQuerySchema, type JobSearchQuery } from '@jobtrack/shared';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { PrismaService } from '../../common/prisma.service';
import type { RedisService } from '../../common/redis.service';
import { JobIngestionService } from './job-ingestion.service';
import { JobSyncService, mapContractTypesToFranceTravail } from './job-sync.service';
import type { FranceTravailOffer } from './sources/france-travail/france-travail.schemas';
import type { JobSourceConnector, SourceCommune, SourceOffer, SourceQuery } from './sources/job-source.connector';
import { SourceNotConfiguredError, SourceUnavailableError } from './sources/source.errors';

const prisma = new PrismaService();
const ingestion = new JobIngestionService(prisma);

// Préfixe distinctif par processus : deux workers vitest ne partagent jamais la même entreprise.
const COMPANY_PREFIX = `Sync Test ${process.pid}`;

async function cleanup(): Promise<void> {
  await prisma.job.deleteMany({ where: { company: { startsWith: COMPANY_PREFIX } } });
  await prisma.jobSearchSync.deleteMany({ where: { queryJson: { path: ['q'], string_contains: 'sync-test' } } });
}

beforeEach(cleanup);
afterAll(async () => {
  await cleanup();
  await prisma.$disconnect();
});

/** Redis en mémoire : `get`/`set` (avec `NX`)/`del`, seules commandes utilisées par `JobSyncService`. */
class FakeRedis {
  private readonly store = new Map<string, string>();

  errorOnGet = false;
  errorOnSet = false;

  get(key: string): Promise<string | null> {
    if (this.errorOnGet) return Promise.reject(new Error('redis get indisponible (fake)'));
    return Promise.resolve(this.store.get(key) ?? null);
  }

  set(key: string, value: string, ...args: unknown[]): Promise<'OK' | null> {
    if (this.errorOnSet) return Promise.reject(new Error('redis set indisponible (fake)'));
    if (args.includes('NX') && this.store.has(key)) return Promise.resolve(null);
    this.store.set(key, value);
    return Promise.resolve('OK');
  }

  del(key: string): Promise<number> {
    return Promise.resolve(this.store.delete(key) ? 1 : 0);
  }

  seed(key: string, value: string): void {
    this.store.set(key, value);
  }
}

function fakeRedisService(redis: FakeRedis): RedisService {
  return { client: redis } as unknown as RedisService;
}

function buildOffer(externalId: string, overrides: Partial<FranceTravailOffer> = {}): SourceOffer {
  return {
    kind: 'FRANCE_TRAVAIL',
    externalId,
    raw: { id: externalId, intitule: `Poste ${externalId}`, formations: [], langues: [], competences: [], ...overrides },
  };
}

type SearchStep = SourceOffer[] | Error;

/** Connecteur scripté : une réponse (offres ou erreur) par appel à `search`, dans l'ordre. */
class FakeConnector implements JobSourceConnector {
  readonly kind = 'FRANCE_TRAVAIL';
  readonly calls: SourceQuery[] = [];
  private readonly steps: SearchStep[];

  constructor(steps: SearchStep[] = []) {
    this.steps = [...steps];
  }

  search(query: SourceQuery): Promise<SourceOffer[]> {
    this.calls.push(query);
    const step = this.steps.shift();
    if (step === undefined) return Promise.resolve([]);
    if (step instanceof Error) return Promise.reject(step);
    return Promise.resolve(step);
  }

  getOffer(): Promise<SourceOffer | null> {
    return Promise.resolve(null);
  }

  listCommunes(): Promise<SourceCommune[]> {
    return Promise.resolve([]);
  }
}

function buildQuery(overrides: Partial<JobSearchQuery> = {}): JobSearchQuery {
  return { ...jobSearchQuerySchema.parse({}), q: 'sync-test', ...overrides };
}

function makeService(connector: JobSourceConnector | null, redis: FakeRedis = new FakeRedis()): JobSyncService {
  const connectors = connector ? [connector] : [];
  return new JobSyncService(prisma, fakeRedisService(redis), ingestion, connectors);
}

describe('JobSyncService.ensureFresh', () => {
  it('renvoie not_configured sans connecteur, sans jamais lever', async () => {
    const service = makeService(null);
    const result = await service.ensureFresh(buildQuery());

    expect(result.status).toBe('not_configured');
    expect(result.syncedAt).toBeNull();
    expect(result.message).toContain('pas configuré');
  });

  it('un succes total ingere les offres et renvoie ok', async () => {
    const connector = new FakeConnector([[buildOffer('FT-SYNC-1')]]);
    const service = makeService(connector);

    const result = await service.ensureFresh(buildQuery({ q: 'sync-test-ok' }));

    expect(result.status).toBe('ok');
    expect(result.message).toBeNull();
    expect(connector.calls).toHaveLength(1);
  });

  it('un succes en cache evite un second appel au connecteur', async () => {
    const redis = new FakeRedis();
    const connector = new FakeConnector([[buildOffer('FT-SYNC-CACHE')]]);
    const service = makeService(connector, redis);
    const query = buildQuery({ q: 'sync-test-cache' });

    const first = await service.ensureFresh(query);
    expect(first.status).toBe('ok');
    expect(connector.calls).toHaveLength(1);

    const second = await service.ensureFresh(query);
    expect(second.status).toBe('cached');
    expect(second.syncedAt).toBe(first.syncedAt);
    expect(connector.calls).toHaveLength(1);
  });

  it('un verrou deja pose evite un second appel au connecteur', async () => {
    const redis = new FakeRedis();
    const hash = new JobSyncService(prisma, fakeRedisService(redis), ingestion, []).computeQueryHash(
      buildQuery({ q: 'sync-test-lock' }),
    );
    redis.seed(`jobs:sync:lock:${hash}`, '1');
    const connector = new FakeConnector([[buildOffer('FT-SYNC-LOCK')]]);
    const service = makeService(connector, redis);

    const result = await service.ensureFresh(buildQuery({ q: 'sync-test-lock' }));

    expect(result.message).toBe('Actualisation déjà en cours.');
    expect(connector.calls).toHaveLength(0);
  });

  it('echec partiel (une commune sur deux) avec des resultats : ok, mais ingestion partielle et JobSearchSync PARTIAL', async () => {
    const connector = new FakeConnector([
      new SourceUnavailableError('FRANCE_TRAVAIL'),
      [buildOffer('FT-SYNC-PARTIAL', { entreprise: { nom: `${COMPANY_PREFIX} Partiel` } })],
    ]);
    const service = makeService(connector);
    const query = buildQuery({ q: 'sync-test-partial', communes: ['57463', '75056'] });

    const result = await service.ensureFresh(query);

    expect(result.status).toBe('ok');
    expect(connector.calls).toHaveLength(2);
    const sync = await prisma.jobSearchSync.findUniqueOrThrow({ where: { queryHash: service.computeQueryHash(query) } });
    expect(sync.lastStatus).toBe('PARTIAL');
    expect(sync.resultCount).toBe(1);
    const job = await prisma.job.findFirst({ where: { company: `${COMPANY_PREFIX} Partiel` } });
    expect(job).not.toBeNull();
  });

  it('echec partiel sans aucun resultat : degrade', async () => {
    const connector = new FakeConnector([new SourceUnavailableError('FRANCE_TRAVAIL'), []]);
    const service = makeService(connector);
    const query = buildQuery({ q: 'sync-test-partial-zero', communes: ['57463', '75056'] });

    const result = await service.ensureFresh(query);

    expect(result.status).toBe('degraded');
    expect(result.message).toContain('France Travail ne répond pas');
    const sync = await prisma.jobSearchSync.findUniqueOrThrow({ where: { queryHash: service.computeQueryHash(query) } });
    expect(sync.lastStatus).toBe('PARTIAL');
    expect(sync.resultCount).toBe(0);
  });

  it('echec total : degrade et JobSearchSync FAILED, jamais mis en cache', async () => {
    const connector = new FakeConnector([new SourceUnavailableError('FRANCE_TRAVAIL')]);
    const service = makeService(connector);
    const query = buildQuery({ q: 'sync-test-failed' });

    const result = await service.ensureFresh(query);

    expect(result.status).toBe('degraded');
    const sync = await prisma.jobSearchSync.findUniqueOrThrow({ where: { queryHash: service.computeQueryHash(query) } });
    expect(sync.lastStatus).toBe('FAILED');
    expect(sync.lastError).toContain('SourceUnavailableError');
  });

  it('SourceNotConfiguredError leve par le connecteur devient not_configured', async () => {
    const connector = new FakeConnector([new SourceNotConfiguredError('FRANCE_TRAVAIL')]);
    const service = makeService(connector);

    const result = await service.ensureFresh(buildQuery({ q: 'sync-test-not-configured' }));

    expect(result.status).toBe('not_configured');
  });

  it('force supprime le cache avant de resynchroniser', async () => {
    const redis = new FakeRedis();
    const connector = new FakeConnector([[buildOffer('FT-SYNC-FORCE-1')], [buildOffer('FT-SYNC-FORCE-2')]]);
    const service = makeService(connector, redis);
    const query = buildQuery({ q: 'sync-test-force' });

    await service.ensureFresh(query);
    expect(connector.calls).toHaveLength(1);

    const forced = await service.ensureFresh(query, { force: true });
    expect(forced.status).toBe('ok');
    expect(connector.calls).toHaveLength(2);
  });

  it('le hash de requete ignore page, tri et onglet', () => {
    const service = makeService(null);
    const a = buildQuery({ q: 'sync-test-hash', page: 1, sort: 'recent', tab: 'all' });
    const b = buildQuery({ q: 'sync-test-hash', page: 3, sort: 'salary', tab: 'new' });
    expect(service.computeQueryHash(a)).toBe(service.computeQueryHash(b));
  });

  it('le hash de requete ignore l_ordre des communes', () => {
    const service = makeService(null);
    const a = buildQuery({ q: 'sync-test-hash-communes', communes: ['57463', '75056'] });
    const b = buildQuery({ q: 'sync-test-hash-communes', communes: ['75056', '57463'] });
    expect(service.computeQueryHash(a)).toBe(service.computeQueryHash(b));
  });
});

describe('mapContractTypesToFranceTravail', () => {
  it('mappe chaque type de contrat vers ses codes France Travail', () => {
    expect(mapContractTypesToFranceTravail(['CDI'])).toEqual(['CDI']);
    expect(mapContractTypesToFranceTravail(['CDD'])).toEqual(['CDD', 'SAI']);
    expect(mapContractTypesToFranceTravail(['INTERIM'])).toEqual(['MIS']);
    expect(mapContractTypesToFranceTravail(['FREELANCE'])).toEqual(['LIB', 'FRA', 'CCE', 'REP']);
    expect(mapContractTypesToFranceTravail(['APPRENTICESHIP'])).toEqual([]);
    expect(mapContractTypesToFranceTravail(['INTERNSHIP'])).toEqual([]);
    expect(mapContractTypesToFranceTravail(['PART_TIME'])).toEqual([]);
  });

  it('dedoublonne les codes partages entre plusieurs types', () => {
    expect(mapContractTypesToFranceTravail(['CDD', 'CDI'])).toEqual(['CDD', 'SAI', 'CDI']);
  });
});
