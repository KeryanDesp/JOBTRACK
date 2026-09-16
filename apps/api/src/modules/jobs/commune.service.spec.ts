import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { PrismaService } from '../../common/prisma.service';
import type { RedisService } from '../../common/redis.service';
import { CommuneService } from './commune.service';
import { normalizeForKey } from './lib/text';
import type { JobSourceConnector, SourceCommune } from './sources/job-source.connector';

const prisma = new PrismaService();

// Codes hors plage INSEE réelle (9xxxx) : jamais en collision avec un vrai référentiel chargé ailleurs.
const CODE_PREFIX = `9${process.pid.toString().slice(-4).padStart(4, '0')}`;
const code = (suffix: string): string => `${CODE_PREFIX}${suffix}`;

async function cleanup(): Promise<void> {
  await prisma.commune.deleteMany({ where: { code: { startsWith: CODE_PREFIX } } });
}

beforeEach(cleanup);
afterAll(async () => {
  await cleanup();
  await prisma.$disconnect();
});

class FakeRedis {
  private readonly store = new Map<string, string>();
  listCommunesCalls = 0;

  get(key: string): Promise<string | null> {
    return Promise.resolve(this.store.get(key) ?? null);
  }

  set(key: string, value: string): Promise<'OK'> {
    this.store.set(key, value);
    return Promise.resolve('OK');
  }
}

function fakeRedisService(redis: FakeRedis): RedisService {
  return { client: redis } as unknown as RedisService;
}

class FakeConnector implements JobSourceConnector {
  readonly kind = 'FRANCE_TRAVAIL';
  calls = 0;

  constructor(private readonly communes: SourceCommune[]) {}

  search(): Promise<[]> {
    return Promise.resolve([]);
  }

  getOffer(): Promise<null> {
    return Promise.resolve(null);
  }

  listCommunes(): Promise<SourceCommune[]> {
    this.calls += 1;
    return Promise.resolve(this.communes);
  }
}

const SAMPLE_COMMUNES: SourceCommune[] = [
  { code: code('1'), name: 'Metz', postalCode: '57000', departmentCode: '57' },
  { code: code('2'), name: 'Metz-Tessy', postalCode: '74370', departmentCode: '74' },
  { code: code('3'), name: 'Nancy', postalCode: '54000', departmentCode: '54' },
];

describe('CommuneService.ensureLoaded', () => {
  it('charge le referentiel une seule fois (cle Redis 30 jours)', async () => {
    const redis = new FakeRedis();
    const connector = new FakeConnector(SAMPLE_COMMUNES);
    const service = new CommuneService(prisma, fakeRedisService(redis), [connector]);

    await service.ensureLoaded();
    await service.ensureLoaded();

    expect(connector.calls).toBe(1);
    const rows = await prisma.commune.findMany({ where: { code: { startsWith: CODE_PREFIX } } });
    expect(rows).toHaveLength(3);
  });

  it('ne leve jamais si le connecteur echoue', async () => {
    const redis = new FakeRedis();
    const connector: JobSourceConnector = {
      kind: 'FRANCE_TRAVAIL',
      search: () => Promise.resolve([]),
      getOffer: () => Promise.resolve(null),
      listCommunes: () => Promise.reject(new Error('panne referentiel (fake)')),
    };
    const service = new CommuneService(prisma, fakeRedisService(redis), [connector]);

    await expect(service.ensureLoaded()).resolves.toBeUndefined();
  });

  it('ne fait rien sans connecteur configure', async () => {
    const redis = new FakeRedis();
    const service = new CommuneService(prisma, fakeRedisService(redis), []);

    await expect(service.ensureLoaded()).resolves.toBeUndefined();
    const rows = await prisma.commune.findMany({ where: { code: { startsWith: CODE_PREFIX } } });
    expect(rows).toHaveLength(0);
  });
});

describe('CommuneService.search', () => {
  beforeEach(async () => {
    await prisma.commune.createMany({
      data: SAMPLE_COMMUNES.map((commune) => ({
        code: commune.code,
        name: commune.name,
        nameNormalized: normalizeForKey(commune.name),
        postalCode: commune.postalCode,
        departmentCode: commune.departmentCode,
      })),
    });
  });

  it('recherche par prefixe de nom normalise', async () => {
    const service = new CommuneService(prisma, fakeRedisService(new FakeRedis()), []);
    const results = await service.search('metz');
    expect(results.map((r) => r.name).sort()).toEqual(['Metz', 'Metz-Tessy']);
  });

  it('recherche par code postal', async () => {
    const service = new CommuneService(prisma, fakeRedisService(new FakeRedis()), []);
    const results = await service.search('57000');
    expect(results).toHaveLength(1);
    expect(results[0]?.name).toBe('Metz');
  });

  it('renvoie une liste vide pour une saisie vide', async () => {
    const service = new CommuneService(prisma, fakeRedisService(new FakeRedis()), []);
    expect(await service.search('   ')).toEqual([]);
  });
});

describe('CommuneService.resolveByName', () => {
  beforeEach(async () => {
    await prisma.commune.createMany({
      data: SAMPLE_COMMUNES.map((commune) => ({
        code: commune.code,
        name: commune.name,
        nameNormalized: normalizeForKey(commune.name),
        postalCode: commune.postalCode,
        departmentCode: commune.departmentCode,
      })),
    });
  });

  it('resout une correspondance exacte en priorite', async () => {
    const service = new CommuneService(prisma, fakeRedisService(new FakeRedis()), []);
    const result = await service.resolveByName('Metz');
    expect(result?.code).toBe(code('1'));
  });

  it('resout par prefixe quand aucune correspondance exacte n_existe', async () => {
    const service = new CommuneService(prisma, fakeRedisService(new FakeRedis()), []);
    const result = await service.resolveByName('Metz-Tes');
    expect(result?.code).toBe(code('2'));
  });

  it('renvoie null si aucune commune ne correspond', async () => {
    const service = new CommuneService(prisma, fakeRedisService(new FakeRedis()), []);
    expect(await service.resolveByName('Ville-Inconnue-Xyz')).toBeNull();
  });
});
