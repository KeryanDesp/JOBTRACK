import { randomUUID } from 'node:crypto';
import type { NestFastifyApplication } from '@nestjs/platform-fastify';
import { Test } from '@nestjs/testing';
import type { CommuneDto, JobDetailDto, JobListResponseDto, JobSummaryDto } from '@jobtrack/shared';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { AppModule } from '../../app.module';
import { configureApp, createAdapter } from '../../app.setup';
import { PrismaService } from '../../common/prisma.service';
import { RedisService } from '../../common/redis.service';
import { SessionService } from '../auth/session.service';
import { CommuneService } from './commune.service';
import { JOB_SOURCE_CONNECTORS, type JobSourceConnector } from './sources/job-source.connector';
import { SourceUnavailableError } from './sources/source.errors';
import { FakeConnector } from './testing/fake-connector';

const BASE = '/api/v1/jobs';

// Codes du référentiel de test (`fixtures/france-travail/communes-sample.json`), à
// l'exclusion des deux lignes invalides (code ou libellé vide, jamais insérées).
const SAMPLE_COMMUNE_CODES = [
  '57463',
  '54395',
  '75101',
  '2A004',
  '97411',
  '69123',
  '33063',
  '31555',
  '13055',
  '59350',
  '67482',
  '35238',
];

let app: NestFastifyApplication;
let unconfiguredApp: NestFastifyApplication;
let prisma: PrismaService;
let redis: RedisService;
let fake: FakeConnector;

async function buildApp(connectors: JobSourceConnector[]): Promise<NestFastifyApplication> {
  const moduleRef = await Test.createTestingModule({ imports: [AppModule] })
    .overrideProvider(JOB_SOURCE_CONNECTORS)
    .useValue(connectors)
    .compile();
  const built = moduleRef.createNestApplication<NestFastifyApplication>(createAdapter());
  await configureApp(built);
  await built.init();
  await built.getHttpAdapter().getInstance().ready();
  return built;
}

async function clearJobs(): Promise<void> {
  // Cascade Prisma (`onDelete: Cascade`) : supprime `JobSource`/`JobSkill`/`JobRequirement`/
  // `SavedJob` avec le `Job` — jamais besoin de les vider séparément. Le préfixe `FT-` est
  // porté par toutes les offres de fixtures ET l'offre synthétique du connecteur factice,
  // jamais par une donnée d'une autre suite.
  await prisma.job.deleteMany({ where: { sources: { some: { externalId: { startsWith: 'FT-' } } } } });
}

async function clearSyncMemory(): Promise<void> {
  await prisma.jobSearchSync.deleteMany({});
}

async function clearCommunes(): Promise<void> {
  await prisma.commune.deleteMany({ where: { code: { in: SAMPLE_COMMUNE_CODES } } });
}

async function clearRedisKeys(): Promise<void> {
  const jobsKeys = await redis.client.keys('jobs:*');
  const rateKeys = await redis.client.keys('ratelimit:*');
  const all = [...jobsKeys, ...rateKeys];
  if (all.length > 0) await redis.client.del(...all);
}

async function clearUsers(): Promise<void> {
  const users = await prisma.user.findMany({ where: { email: { startsWith: 'e2e-jobs-' } }, select: { id: true } });
  const sessions = app.get(SessionService);
  for (const user of users) {
    await sessions.destroyAllForUser(user.id);
  }
  await prisma.user.deleteMany({ where: { email: { startsWith: 'e2e-jobs-' } } });
}

function rawCookies(headers: Record<string, unknown>): string[] {
  const raw = headers['set-cookie'];
  if (raw === undefined) return [];
  if (Array.isArray(raw)) return raw.map(String);
  return typeof raw === 'string' ? [raw] : [];
}

function cookiesFrom(headers: Record<string, unknown>): string {
  return rawCookies(headers)
    .map((entry) => entry.split(';')[0])
    .join('; ');
}

function csrfFrom(cookieHeader: string): string {
  return /jt_csrf=([^;]+)/.exec(cookieHeader)?.[1] ?? '';
}

interface Session {
  userId: string;
  cookieHeader: string;
  csrf: string;
}

async function registerUser(target: NestFastifyApplication = app): Promise<Session> {
  const email = `e2e-jobs-${process.pid}-${randomUUID()}@jobtrack.local`;
  const response = await target.inject({
    method: 'POST',
    url: '/api/v1/auth/register',
    payload: { email, password: 'motdepasse-solide-2026', firstName: 'E2E', lastName: 'Jobs' },
  });
  const cookieHeader = cookiesFrom(response.headers);
  const userId = response.json<{ id: string }>().id;
  return { userId, cookieHeader, csrf: csrfFrom(cookieHeader) };
}

function authHeaders(session: Session, extra: Record<string, string> = {}): Record<string, string> {
  return { cookie: session.cookieHeader, 'x-csrf-token': session.csrf, ...extra };
}

async function getJson<T>(
  session: Session,
  path: string,
  target: NestFastifyApplication = app,
): Promise<{ statusCode: number; body: T }> {
  const response = await target.inject({ method: 'GET', url: `${BASE}${path}`, headers: authHeaders(session) });
  return { statusCode: response.statusCode, body: response.json<T>() };
}

/** Synchronise puis renvoie la liste (query par défaut sauf indication contraire). */
async function search(
  session: Session,
  query = '',
  target: NestFastifyApplication = app,
): Promise<{ statusCode: number; body: JobListResponseDto }> {
  return getJson<JobListResponseDto>(session, query ? `?${query}` : '', target);
}

function findByCompany(items: JobSummaryDto[], company: string): JobSummaryDto {
  const found = items.find((item) => item.company === company);
  if (!found) throw new Error(`Offre introuvable pour l'entreprise ${company} parmi ${items.length} éléments.`);
  return found;
}

beforeAll(async () => {
  fake = new FakeConnector();
  app = await buildApp([fake]);
  unconfiguredApp = await buildApp([]);

  prisma = app.get(PrismaService);
  redis = app.get(RedisService);
});

beforeEach(async () => {
  await clearUsers();
  await clearJobs();
  await clearSyncMemory();
  await clearCommunes();
  await clearRedisKeys();
  fake.calls = 0;
  // Reconstitue le référentiel des communes (vidé ci-dessus) pour les tests qui en ont besoin ;
  // le verrou Redis (`jobs:communes:loadedAt`) vient d'être effacé, `ensureLoaded` recharge donc
  // à nouveau depuis le connecteur factice plutôt que de considérer le référentiel à jour.
  await app.get(CommuneService).ensureLoaded();
});

afterAll(async () => {
  await clearUsers();
  await clearJobs();
  await clearSyncMemory();
  await clearCommunes();
  await clearRedisKeys();
  await app.close();
  await unconfiguredApp.close();
});

describe('GET /jobs/capabilities', () => {
  it('annonce France Travail configure quand un connecteur est present', async () => {
    const session = await registerUser();
    const response = await getJson<{ sources: { franceTravail: boolean } }>(session, '/capabilities');
    expect(response.statusCode).toBe(200);
    expect(response.body.sources.franceTravail).toBe(true);
  });

  it('annonce France Travail non configure sans connecteur', async () => {
    const session = await registerUser(unconfiguredApp);
    const response = await getJson<{ sources: { franceTravail: boolean } }>(session, '/capabilities', unconfiguredApp);
    expect(response.statusCode).toBe(200);
    expect(response.body.sources.franceTravail).toBe(false);
  });
});

describe('GET /jobs — synchronisation et cache', () => {
  it('synchronise puis liste : sync ok, offres mappees, aucun champ interne', async () => {
    const session = await registerUser();

    const response = await search(session);

    expect(response.statusCode).toBe(200);
    expect(response.body.sync.status).toBe('ok');
    expect(response.body.sync.syncedAt).not.toBeNull();
    expect(response.body.items.length).toBeGreaterThan(0);
    expect(response.body.page).toBe(1);
    expect(response.body.pageSize).toBe(20);

    const solaris = findByCompany(response.body.items, 'Solaris Ingénierie');
    expect(solaris.saved).toBe(false);
    expect(solaris.sources).toEqual(['FRANCE_TRAVAIL']);
    expect(solaris).not.toHaveProperty('description');
    expect(solaris).not.toHaveProperty('fingerprint');
    expect(solaris).not.toHaveProperty('storageKey');
  });

  it('un second appel identique est servi depuis le cache, sans rappeler le connecteur', async () => {
    const session = await registerUser();

    const first = await search(session);
    const callsAfterFirst = fake.calls;
    expect(first.body.sync.status).toBe('ok');

    const second = await search(session);
    expect(second.body.sync.status).toBe('cached');
    expect(fake.calls).toBe(callsAfterFirst);
  });

  it('refresh=1 declenche un nouvel appel au connecteur', async () => {
    const session = await registerUser();

    await search(session);
    const callsAfterFirst = fake.calls;

    const refreshed = await search(session, 'refresh=1');
    expect(refreshed.body.sync.status).toBe('ok');
    expect(fake.calls).toBeGreaterThan(callsAfterFirst);
  });

  it('un 7e refresh en 10 minutes est limite (429 RATE_LIMITED)', async () => {
    const session = await registerUser();

    for (let attempt = 0; attempt < 6; attempt += 1) {
      const response = await search(session, 'refresh=1');
      expect(response.statusCode).toBe(200);
    }

    const seventh = await getJson<{ code: string; message: string }>(session, '?refresh=1');
    expect(seventh.statusCode).toBe(429);
    expect(seventh.body.code).toBe('RATE_LIMITED');
    expect(seventh.body.message).toBe("Trop d'actualisations. Réessayez dans quelques minutes.");
  });

  it('une source en panne degrade la synchronisation sans jamais rendre la liste indisponible', async () => {
    const session = await registerUser();
    fake.failNext(new SourceUnavailableError('FRANCE_TRAVAIL'));

    const response = await search(session);

    expect(response.statusCode).toBe(200);
    expect(response.body.sync.status).toBe('degraded');
    expect(response.body.sync.message).not.toBeNull();
  });
});

describe('Connecteur non configure', () => {
  it("sync.status vaut not_configured, la liste reste servie depuis la base", async () => {
    const configuredSession = await registerUser();
    await search(configuredSession); // ingère les offres via le connecteur factice

    const unconfiguredSession = await registerUser(unconfiguredApp);
    const response = await search(unconfiguredSession, '', unconfiguredApp);

    expect(response.statusCode).toBe(200);
    expect(response.body.sync.status).toBe('not_configured');
    expect(response.body.items.length).toBeGreaterThan(0);
  });
});

describe('GET /jobs — filtres et tri', () => {
  it('contrat=CDI ne renvoie que des offres CDI', async () => {
    const session = await registerUser();
    const response = await search(session, 'contrat=CDI');

    expect(response.body.items.length).toBeGreaterThan(0);
    for (const item of response.body.items) expect(item.contractType).toBe('CDI');
  });

  it('remote=HYBRID isole l_offre en teletravail partiel', async () => {
    const session = await registerUser();
    const response = await search(session, 'remote=HYBRID');

    expect(response.body.items.length).toBeGreaterThan(0);
    for (const item of response.body.items) expect(item.remoteMode).toBe('HYBRID');
    expect(response.body.items.some((item) => item.company === 'BrightLoop Technologies')).toBe(true);
  });

  it('exp=JUNIOR ne renvoie que des offres de niveau junior', async () => {
    const session = await registerUser();
    const response = await search(session, 'exp=JUNIOR');

    expect(response.body.items.length).toBeGreaterThan(0);
    for (const item of response.body.items) expect(item.experienceLevel).toBe('JUNIOR');
  });

  it('salaire=40000 ne renvoie que des offres dont le salaire annuel connu atteint ce seuil', async () => {
    const session = await registerUser();
    const response = await search(session, 'salaire=40000');

    expect(response.body.items.length).toBeGreaterThan(0);
    for (const item of response.body.items) {
      const best = item.salaryMaxAnnual ?? item.salaryMinAnnual;
      expect(best).not.toBeNull();
      expect(best as number).toBeGreaterThanOrEqual(40_000);
    }
    // Une offre sans salaire exploitable ("Selon profil") ne doit jamais apparaître.
    expect(response.body.items.some((item) => item.company === 'Verdania SAS')).toBe(false);
  });

  it('depuis=1 ne renvoie que des offres publiees dans les 24 dernieres heures', async () => {
    const session = await registerUser();
    const response = await search(session, 'depuis=1');

    expect(response.body.items.length).toBeGreaterThan(0);
    const now = Date.now();
    for (const item of response.body.items) {
      expect(now - new Date(item.publishedAt).getTime()).toBeLessThanOrEqual(24 * 60 * 60 * 1000 + 1000);
    }
    // Nancy (FT-0002) est délibérément ancienne dans le connecteur factice.
    expect(response.body.items.some((item) => item.company === 'Nova Systèmes')).toBe(false);
  });

  it('onglet=new se comporte comme depuis=1 (publiees depuis 24 h)', async () => {
    const session = await registerUser();
    const response = await search(session, 'onglet=new');

    expect(response.body.items.length).toBeGreaterThan(0);
    expect(response.body.items.some((item) => item.company === 'Nova Systèmes')).toBe(false);
  });

  it('lieu=57463 limite aux offres de Metz (et de son departement)', async () => {
    const session = await registerUser();
    const response = await search(session, 'lieu=57463');

    expect(response.body.items.length).toBeGreaterThan(0);
    for (const item of response.body.items) expect(item.departmentCode).toBe('57');
    expect(response.body.items.some((item) => item.company === 'Solaris Ingénierie')).toBe(true);
  });

  it('q=react trouve l_offre dont le titre mentionne React', async () => {
    const session = await registerUser();
    const response = await search(session, 'q=react');

    expect(response.body.items.length).toBeGreaterThan(0);
    for (const item of response.body.items) expect(item.title.toLowerCase()).toContain('react');
    expect(response.body.items.some((item) => item.company === 'Piloto Software')).toBe(true);
  });

  it('tri=salary trie par salaire maximal descendant, valeurs inconnues en dernier', async () => {
    const session = await registerUser();
    const response = await search(session, 'tri=salary');

    const salaries = response.body.items.map((item) => item.salaryMaxAnnual);
    const firstNullIndex = salaries.findIndex((value) => value === null);
    if (firstNullIndex !== -1) {
      for (const value of salaries.slice(firstNullIndex)) expect(value).toBeNull();
    }
    const known = salaries.filter((value): value is number => value !== null);
    for (let index = 1; index < known.length; index += 1) {
      expect(known[index]).toBeLessThanOrEqual(known[index - 1] as number);
    }
  });

  it('la pagination renvoie une page 2 vide avec le total correct quand il y a moins de 20 offres', async () => {
    const session = await registerUser();
    const firstPage = await search(session);
    const total = firstPage.body.total;
    expect(total).toBeLessThanOrEqual(20);

    const secondPage = await search(session, 'page=2');
    expect(secondPage.body.items).toEqual([]);
    expect(secondPage.body.total).toBe(total);
    expect(secondPage.body.page).toBe(2);
  });

  it('rayon=500 est refuse (400 VALIDATION_ERROR)', async () => {
    const session = await registerUser();
    const response = await getJson<{ code: string }>(session, '?rayon=500');
    expect(response.statusCode).toBe(400);
    expect(response.body.code).toBe('VALIDATION_ERROR');
  });
});

describe('GET /jobs/:id — detail', () => {
  it('renvoie le detail complet (sources, competences, exigences, saved)', async () => {
    const session = await registerUser();
    const list = await search(session);
    const summary = findByCompany(list.body.items, 'Solaris Ingénierie');

    const response = await getJson<JobDetailDto>(session, `/${summary.id}`);

    expect(response.statusCode).toBe(200);
    expect(response.body.saved).toBe(false);
    expect(response.body.sources).toEqual([
      expect.objectContaining({ kind: 'FRANCE_TRAVAIL', externalId: 'FT-0001' }),
    ]);
    expect(response.body.skills.length).toBeGreaterThan(0);
    expect(response.body.requirements.length).toBeGreaterThan(0);
    expect(response.body.description.length).toBeGreaterThan(0);
  });

  it('une offre inconnue renvoie 404 JOB_NOT_FOUND', async () => {
    const session = await registerUser();
    const response = await getJson<{ code: string }>(session, '/offre-inexistante');
    expect(response.statusCode).toBe(404);
    expect(response.body.code).toBe('JOB_NOT_FOUND');
  });

  it('une offre non revue depuis plus de 24h et disparue de la source devient expiree', async () => {
    const session = await registerUser();
    const list = await search(session);
    const nova = findByCompany(list.body.items, 'Nova Systèmes');

    await prisma.job.update({
      where: { id: nova.id },
      data: { lastSeenAt: new Date(Date.now() - 25 * 60 * 60 * 1000) },
    });
    fake.markRemoved('FT-0002');

    const detail = await getJson<JobDetailDto>(session, `/${nova.id}`);
    expect(detail.body.expiredAt).not.toBeNull();

    const afterExpiry = await search(session);
    expect(afterExpiry.body.items.some((item) => item.id === nova.id)).toBe(false);
  });
});

describe('Favoris', () => {
  it('sauvegarder une offre la marque saved dans la liste et dans /jobs/saved', async () => {
    const session = await registerUser();
    const list = await search(session);
    const solaris = findByCompany(list.body.items, 'Solaris Ingénierie');

    const save = await app.inject({
      method: 'POST',
      url: `${BASE}/${solaris.id}/save`,
      headers: authHeaders(session),
    });
    expect(save.statusCode).toBe(204);

    const relisted = await search(session);
    expect(findByCompany(relisted.body.items, 'Solaris Ingénierie').saved).toBe(true);

    const saved = await getJson<JobSummaryDto[]>(session, '/saved');
    expect(saved.body.some((item) => item.id === solaris.id && item.saved)).toBe(true);
  });

  it('sauvegarder deux fois est idempotent (une seule ligne)', async () => {
    const session = await registerUser();
    const list = await search(session);
    const solaris = findByCompany(list.body.items, 'Solaris Ingénierie');

    for (let attempt = 0; attempt < 2; attempt += 1) {
      const response = await app.inject({
        method: 'POST',
        url: `${BASE}/${solaris.id}/save`,
        headers: authHeaders(session),
      });
      expect(response.statusCode).toBe(204);
    }

    const count = await prisma.savedJob.count({ where: { userId: session.userId, jobId: solaris.id } });
    expect(count).toBe(1);
  });

  it('sauvegarder une offre inconnue renvoie 404 JOB_NOT_FOUND', async () => {
    const session = await registerUser();
    const response = await app.inject({
      method: 'POST',
      url: `${BASE}/offre-inexistante/save`,
      headers: authHeaders(session),
    });
    expect(response.statusCode).toBe(404);
    expect(response.json<{ code: string }>().code).toBe('JOB_NOT_FOUND');
  });

  it('retirer une offre est idempotent, y compris quand elle n_est pas sauvegardee', async () => {
    const session = await registerUser();
    const list = await search(session);
    const solaris = findByCompany(list.body.items, 'Solaris Ingénierie');

    await app.inject({ method: 'POST', url: `${BASE}/${solaris.id}/save`, headers: authHeaders(session) });

    const firstUnsave = await app.inject({
      method: 'DELETE',
      url: `${BASE}/${solaris.id}/save`,
      headers: authHeaders(session),
    });
    expect(firstUnsave.statusCode).toBe(204);

    const relisted = await search(session);
    expect(findByCompany(relisted.body.items, 'Solaris Ingénierie').saved).toBe(false);

    const secondUnsave = await app.inject({
      method: 'DELETE',
      url: `${BASE}/${solaris.id}/save`,
      headers: authHeaders(session),
    });
    expect(secondUnsave.statusCode).toBe(204);
  });

  it('isole les favoris entre utilisateurs : B ne voit ni le drapeau ni l_offre de A', async () => {
    const sessionA = await registerUser();
    const listA = await search(sessionA);
    const solaris = findByCompany(listA.body.items, 'Solaris Ingénierie');

    await app.inject({ method: 'POST', url: `${BASE}/${solaris.id}/save`, headers: authHeaders(sessionA) });

    const sessionB = await registerUser();
    const listB = await search(sessionB);
    expect(findByCompany(listB.body.items, 'Solaris Ingénierie').saved).toBe(false);

    const savedB = await getJson<JobSummaryDto[]>(sessionB, '/saved');
    expect(savedB.body).toEqual([]);
  });
});

describe('GET /jobs/communes', () => {
  it('q=me trouve Metz en premier resultat', async () => {
    const session = await registerUser();
    const response = await getJson<CommuneDto[]>(session, '/communes?q=me');
    expect(response.statusCode).toBe(200);
    expect(response.body[0]?.name).toBe('Metz');
  });

  it('une saisie numerique interroge le code postal (57000 trouve Metz)', async () => {
    const session = await registerUser();
    const response = await getJson<CommuneDto[]>(session, '/communes?q=57000');
    expect(response.statusCode).toBe(200);
    expect(response.body.some((commune) => commune.name === 'Metz')).toBe(true);
  });

  it('une saisie de moins de 2 caracteres renvoie une liste vide', async () => {
    const session = await registerUser();
    const response = await getJson<CommuneDto[]>(session, '/communes?q=m');
    expect(response.statusCode).toBe(200);
    expect(response.body).toEqual([]);
  });
});

describe('Authentification et CSRF', () => {
  it('une requete non authentifiee est refusee (401)', async () => {
    const response = await app.inject({ method: 'GET', url: BASE });
    expect(response.statusCode).toBe(401);
  });

  it('un jeton CSRF absent sur une sauvegarde est refuse (403 CSRF_MISMATCH)', async () => {
    const session = await registerUser();
    const response = await app.inject({
      method: 'POST',
      url: `${BASE}/offre-quelconque/save`,
      headers: { cookie: session.cookieHeader },
    });
    expect(response.statusCode).toBe(403);
    expect(response.json<{ code: string }>().code).toBe('CSRF_MISMATCH');
  });
});
