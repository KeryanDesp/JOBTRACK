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
const EXTERNAL_ID_PREFIX = 'FT-SYNC-';

/**
 * Nettoyage par source (spec ingénierie), jamais par entreprise seule : une offre
 * sans `entreprise` (fixture minimale) ne serait sinon jamais retrouvée et le `Job`
 * fuiterait en base entre deux exécutions. On retire d'abord les `JobSource` de ce
 * lot, puis tout `Job` devenu orphelin (plus aucune source) — jamais un `Job` qui
 * porterait encore une source d'un autre test.
 */
async function cleanup(): Promise<void> {
  await prisma.jobSource.deleteMany({ where: { externalId: { startsWith: EXTERNAL_ID_PREFIX } } });
  await prisma.job.deleteMany({ where: { sources: { none: {} } } });
  await prisma.jobSearchSync.deleteMany({ where: { queryJson: { path: ['q'], string_contains: 'sync-test' } } });
}

beforeEach(cleanup);
afterAll(async () => {
  await cleanup();
  await prisma.$disconnect();
});

/**
 * Redis en mémoire : `get`/`set` (avec `NX`)/`del`/`eval` (verrou par jeton, script
 * de comparaison-puis-suppression ou comparaison-puis-`PEXPIRE`), seules commandes
 * utilisées par `JobSyncService`.
 */
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

  /** Interprète nos deux scripts de verrou (comparaison-puis-`DEL`, comparaison-puis-`PEXPIRE`) par leur contenu. */
  eval(script: string, _numKeys: number, ...args: unknown[]): Promise<number> {
    const key = String(args[0]);
    const token = String(args[1]);
    if (this.store.get(key) !== token) return Promise.resolve(0);
    if (script.includes('DEL')) {
      this.store.delete(key);
      return Promise.resolve(1);
    }
    return Promise.resolve(1);
  }

  seed(key: string, value: string): void {
    this.store.set(key, value);
  }

  has(key: string): boolean {
    return this.store.has(key);
  }
}

function fakeRedisService(redis: FakeRedis): RedisService {
  return { client: redis } as unknown as RedisService;
}

function buildOffer(externalId: string, overrides: Partial<FranceTravailOffer> = {}): SourceOffer {
  return {
    kind: 'FRANCE_TRAVAIL',
    externalId,
    raw: {
      id: externalId,
      intitule: `Poste ${externalId}`,
      formations: [],
      langues: [],
      competences: [],
      entreprise: { nom: COMPANY_PREFIX },
      ...overrides,
    },
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
  it('renvoie not_configured sans connecteur, sans jamais lever, sans message (deja porte par le bandeau client)', async () => {
    const service = makeService(null);
    const result = await service.ensureFresh(buildQuery());

    expect(result.status).toBe('not_configured');
    expect(result.syncedAt).toBeNull();
    expect(result.message).toBeNull();
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

  it('le verrou est libere apres une synchronisation, meme reussie', async () => {
    const redis = new FakeRedis();
    const connector = new FakeConnector([[buildOffer('FT-SYNC-UNLOCK')]]);
    const service = makeService(connector, redis);
    const hash = service.computeQueryHash(buildQuery({ q: 'sync-test-unlock' }));

    await service.ensureFresh(buildQuery({ q: 'sync-test-unlock' }));

    expect(redis.has(`jobs:sync:lock:${hash}`)).toBe(false);
  });

  it('un verrou deja pose (jeton d_un autre porteur) evite un second appel, statut cache sans synchronisation prealable', async () => {
    const redis = new FakeRedis();
    const hash = makeService(null, redis).computeQueryHash(buildQuery({ q: 'sync-test-lock' }));
    redis.seed(`jobs:sync:lock:${hash}`, 'jeton-d-un-autre-porteur');
    const connector = new FakeConnector([[buildOffer('FT-SYNC-LOCK')]]);
    const service = makeService(connector, redis);

    const result = await service.ensureFresh(buildQuery({ q: 'sync-test-lock' }));

    expect(result.status).toBe('cached');
    expect(result.syncedAt).toBeNull();
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

  it('echec partiel sans aucun resultat : degrade, jamais mis en cache', async () => {
    const redis = new FakeRedis();
    const connector = new FakeConnector([new SourceUnavailableError('FRANCE_TRAVAIL'), []]);
    const service = makeService(connector, redis);
    const query = buildQuery({ q: 'sync-test-partial-zero', communes: ['57463', '75056'] });
    const hash = service.computeQueryHash(query);

    const result = await service.ensureFresh(query);

    expect(result.status).toBe('degraded');
    expect(result.message).toContain('France Travail ne répond pas');
    const sync = await prisma.jobSearchSync.findUniqueOrThrow({ where: { queryHash: hash } });
    expect(sync.lastStatus).toBe('PARTIAL');
    expect(sync.resultCount).toBe(0);
    expect(await redis.get(`jobs:sync:${hash}`)).toBeNull();
  });

  it('echec total : degrade et JobSearchSync FAILED, jamais mis en cache', async () => {
    const redis = new FakeRedis();
    const connector = new FakeConnector([new SourceUnavailableError('FRANCE_TRAVAIL')]);
    const service = makeService(connector, redis);
    const query = buildQuery({ q: 'sync-test-failed' });
    const hash = service.computeQueryHash(query);

    const result = await service.ensureFresh(query);

    expect(result.status).toBe('degraded');
    const sync = await prisma.jobSearchSync.findUniqueOrThrow({ where: { queryHash: hash } });
    expect(sync.lastStatus).toBe('FAILED');
    expect(sync.lastError).toContain('SourceUnavailableError');
    expect(await redis.get(`jobs:sync:${hash}`)).toBeNull();
  });

  it('une erreur qui n_est pas une JobSourceError remonte au lieu d_etre avalee', async () => {
    const connector = new FakeConnector([new Error('bug interne (fake)')]);
    const service = makeService(connector);

    await expect(service.ensureFresh(buildQuery({ q: 'sync-test-bug' }))).rejects.toThrow('bug interne (fake)');
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

  it('le hash de requete ignore la distance sans commune', () => {
    const service = makeService(null);
    const a = buildQuery({ q: 'sync-test-hash-national', communes: [], distance: 10 });
    const b = buildQuery({ q: 'sync-test-hash-national', communes: [], distance: 80 });
    expect(service.computeQueryHash(a)).toBe(service.computeQueryHash(b));
  });

  it('le hash de requete repose sur les codes France Travail mappes, pas l_enumeration locale', () => {
    const service = makeService(null);
    // APPRENTICESHIP et INTERNSHIP se mappent tous deux vers aucun code : meme appel a la source.
    const a = buildQuery({ q: 'sync-test-hash-contract', contractTypes: ['APPRENTICESHIP'] });
    const b = buildQuery({ q: 'sync-test-hash-contract', contractTypes: ['INTERNSHIP'] });
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
