import type { NestFastifyApplication } from '@nestjs/platform-fastify';
import { Test } from '@nestjs/testing';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { AppModule } from '../../app.module';
import { configureApp, createAdapter } from '../../app.setup';
import { PrismaService } from '../../common/prisma.service';
import { RedisService } from '../../common/redis.service';
import { GoogleService, type GoogleProfile } from '../auth/google.service';
import { SessionService } from '../auth/session.service';

let app: NestFastifyApplication;
let prisma: PrismaService;
let redis: RedisService;

// Remplace le GoogleService (null en local/CI, GOOGLE_* absent) : ce bootstrap est copié tel
// quel depuis auth.e2e.spec.ts, même si aucun test de ce fichier n'exerce le flux Google.
const fakeGoogle = {
  buildAuthUrl: (state: string, codeChallenge: string) =>
    `https://accounts.google.com/o/oauth2/v2/auth?state=${state}&code_challenge=${codeChallenge}`,
  exchangeCode: vi.fn<(code: string, codeVerifier: string) => Promise<GoogleProfile>>(),
};

const NAMESPACE = `e2e-iso-${process.pid}`;
const ALICE_EMAIL = `${NAMESPACE}-alice@jobtrack.local`;
const BOB_EMAIL = `${NAMESPACE}-bob@jobtrack.local`;
const PASSWORD = 'motdepasse-solide-2026';

interface Actor {
  cookie: string;
  csrf: string;
}

async function clearRateLimits(): Promise<void> {
  const keys = await redis.client.keys('ratelimit:*');
  if (keys.length > 0) await redis.client.del(...keys);
}

async function clearUsers(): Promise<void> {
  // Uniquement les comptes de ce fichier : jamais `endsWith('@jobtrack.local')`, qui effacerait
  // aussi ceux d'autres suites e2e exécutées en parallèle sur le même process.
  const users = await prisma.user.findMany({
    where: { email: { startsWith: NAMESPACE } },
    select: { id: true },
  });
  const sessions = app.get(SessionService);
  for (const user of users) {
    await sessions.destroyAllForUser(user.id);
  }
  await prisma.user.deleteMany({ where: { email: { startsWith: NAMESPACE } } });
}

beforeAll(async () => {
  const moduleRef = await Test.createTestingModule({ imports: [AppModule] })
    .overrideProvider(GoogleService)
    .useValue(fakeGoogle)
    .compile();
  app = moduleRef.createNestApplication<NestFastifyApplication>(createAdapter());
  await configureApp(app);
  await app.init();
  await app.getHttpAdapter().getInstance().ready();

  prisma = app.get(PrismaService);
  redis = app.get(RedisService);
});

beforeEach(async () => {
  await clearUsers();
  await clearRateLimits();
});

afterAll(async () => {
  await clearUsers();
  await clearRateLimits();
  await app.close();
});

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

/** Inscrit un utilisateur e2e et renvoie ses accréditations (cookie de session + jeton CSRF). */
async function signUp(email: string): Promise<Actor> {
  const response = await app.inject({
    method: 'POST',
    url: '/api/v1/auth/register',
    payload: { email, password: PASSWORD, firstName: 'A', lastName: 'B' },
  });
  const cookie = cookiesFrom(response.headers);
  return { cookie, csrf: csrfFrom(cookie) };
}

/** En-têtes d'authentification d'un acteur, prêts pour `app.inject`. */
function as(actor: Actor): Record<string, string> {
  return { cookie: actor.cookie, 'x-csrf-token': actor.csrf };
}

describe('Profil et préférences', () => {
  it('ne laisse jamais un utilisateur lire ou modifier l_experience d_un autre', async () => {
    const alice = await signUp(ALICE_EMAIL);
    const bob = await signUp(BOB_EMAIL);

    const created = await app.inject({
      method: 'POST',
      url: '/api/v1/profile/experiences',
      headers: as(alice),
      payload: { company: 'Acme', role: 'Développeuse', startDate: '2024-01-01', isCurrent: true },
    });
    expect(created.statusCode).toBe(201);
    const experience = created.json<{ id: string; startDate: string; endDate: string | null; sortOrder: number }>();
    expect(experience.startDate).toBe('2024-01-01');
    expect(experience.endDate).toBeNull();
    expect(experience.sortOrder).toBe(0);

    const bobList = await app.inject({ method: 'GET', url: '/api/v1/profile/experiences', headers: as(bob) });
    expect(bobList.statusCode).toBe(200);
    expect(bobList.json()).toEqual([]);

    const bobUpdate = await app.inject({
      method: 'PATCH',
      url: `/api/v1/profile/experiences/${experience.id}`,
      headers: as(bob),
      payload: { company: 'Voleur', role: 'Rôle', startDate: '2024-01-01', isCurrent: true },
    });
    expect(bobUpdate.statusCode).toBe(404);

    const bobDelete = await app.inject({
      method: 'DELETE',
      url: `/api/v1/profile/experiences/${experience.id}`,
      headers: as(bob),
    });
    expect(bobDelete.statusCode).toBe(404);

    const aliceList = await app.inject({ method: 'GET', url: '/api/v1/profile/experiences', headers: as(alice) });
    expect(aliceList.json<{ id: string }[]>()).toHaveLength(1);
  });

  it('ne laisse jamais un utilisateur revoquer la session d_un autre', async () => {
    const alice = await signUp(ALICE_EMAIL);
    const bob = await signUp(BOB_EMAIL);

    const aliceSessions = await app.inject({ method: 'GET', url: '/api/v1/auth/sessions', headers: as(alice) });
    const aliceSessionId = aliceSessions.json<{ id: string }[]>()[0]?.id ?? '';

    const revoke = await app.inject({
      method: 'DELETE',
      url: `/api/v1/auth/sessions/${aliceSessionId}`,
      headers: as(bob),
    });
    expect(revoke.statusCode).toBe(404);

    const stillValid = await app.inject({ method: 'GET', url: '/api/v1/auth/me', headers: as(alice) });
    expect(stillValid.statusCode).toBe(200);
  });

  it('met a jour le profil de l_utilisateur courant uniquement', async () => {
    const alice = await signUp(ALICE_EMAIL);
    const bob = await signUp(BOB_EMAIL);

    const update = await app.inject({
      method: 'PATCH',
      url: '/api/v1/profile',
      headers: as(alice),
      payload: { firstName: 'Alice', lastName: 'Modifiée', city: 'Metz' },
    });
    expect(update.statusCode).toBe(200);

    const bobProfile = await app.inject({ method: 'GET', url: '/api/v1/profile', headers: as(bob) });
    expect(bobProfile.json<{ firstName: string }>().firstName).toBe('A');

    const aliceProfile = await app.inject({ method: 'GET', url: '/api/v1/profile', headers: as(alice) });
    expect(aliceProfile.json<{ city: string | null }>().city).toBe('Metz');

    // Le schéma partagé (packages/shared/src/profile.ts, optionalText) traduit une chaîne vide
    // en `null` côté validé : c'est cette valeur, et non un `null` JSON brut (rejeté par le
    // schéma, qui n'accepte que '' ou une chaîne), qui efface la colonne côté Prisma.
    const clearCity = await app.inject({
      method: 'PATCH',
      url: '/api/v1/profile',
      headers: as(alice),
      payload: { firstName: 'Alice', lastName: 'Modifiée', city: '' },
    });
    expect(clearCity.statusCode).toBe(200);
    expect(clearCity.json<{ city: string | null }>().city).toBeNull();

    const withoutTitle = await app.inject({
      method: 'PATCH',
      url: '/api/v1/profile',
      headers: as(alice),
      payload: { firstName: 'Alice', lastName: 'Modifiée' },
    });
    expect(withoutTitle.statusCode).toBe(200);
    expect(withoutTitle.json<{ title: string | null; city: string | null }>().title).toBeNull();
    // Clé absente : n'écrit pas, donc `city` reste tel que laissé par l'étape précédente.
    expect(withoutTitle.json<{ city: string | null }>().city).toBeNull();
  });

  it('gere le cycle complet d_une collection avec reordonnancement', async () => {
    const alice = await signUp(ALICE_EMAIL);
    const bob = await signUp(BOB_EMAIL);

    const ids: string[] = [];
    for (const company of ['Un', 'Deux', 'Trois']) {
      const response = await app.inject({
        method: 'POST',
        url: '/api/v1/profile/experiences',
        headers: as(alice),
        payload: { company, role: 'Rôle', startDate: '2024-01-01', isCurrent: true },
      });
      ids.push(response.json<{ id: string }>().id);
    }

    const bobExperience = await app.inject({
      method: 'POST',
      url: '/api/v1/profile/experiences',
      headers: as(bob),
      payload: { company: 'Bob', role: 'Rôle', startDate: '2024-01-01', isCurrent: true },
    });
    const bobId = bobExperience.json<{ id: string }>().id;

    const reversed = [...ids].reverse();
    const reorder = await app.inject({
      method: 'PATCH',
      url: '/api/v1/profile/experiences/reorder',
      headers: as(alice),
      payload: { ids: reversed },
    });
    expect(reorder.statusCode).toBe(204);

    const afterReorder = await app.inject({ method: 'GET', url: '/api/v1/profile/experiences', headers: as(alice) });
    expect(afterReorder.json<{ id: string }[]>().map((row) => row.id)).toEqual(reversed);

    const withForeignId = await app.inject({
      method: 'PATCH',
      url: '/api/v1/profile/experiences/reorder',
      headers: as(alice),
      payload: { ids: [reversed[0], bobId, reversed[2]] },
    });
    expect(withForeignId.statusCode).toBe(404);

    const unchanged = await app.inject({ method: 'GET', url: '/api/v1/profile/experiences', headers: as(alice) });
    expect(unchanged.json<{ id: string }[]>().map((row) => row.id)).toEqual(reversed);

    const [firstId] = reversed;
    const update = await app.inject({
      method: 'PATCH',
      url: `/api/v1/profile/experiences/${firstId}`,
      headers: as(alice),
      payload: { company: 'Mise à jour', role: 'Nouveau rôle', startDate: '2023-05-01', endDate: '2024-06-01', isCurrent: false },
    });
    expect(update.statusCode).toBe(200);
    const updated = update.json<{ company: string; startDate: string; endDate: string | null }>();
    expect(updated.company).toBe('Mise à jour');
    expect(updated.startDate).toBe('2023-05-01');
    expect(updated.endDate).toBe('2024-06-01');

    const remove = await app.inject({
      method: 'DELETE',
      url: `/api/v1/profile/experiences/${firstId}`,
      headers: as(alice),
    });
    expect(remove.statusCode).toBe(204);

    const finalList = await app.inject({ method: 'GET', url: '/api/v1/profile/experiences', headers: as(alice) });
    expect(finalList.json<{ id: string }[]>()).toHaveLength(2);
  });

  it('refuse une experience invalide avec le detail par champ', async () => {
    const alice = await signUp(ALICE_EMAIL);

    const response = await app.inject({
      method: 'POST',
      url: '/api/v1/profile/experiences',
      headers: as(alice),
      payload: { company: 'Acme', role: 'Développeuse', startDate: '2024-13-01', isCurrent: true },
    });

    expect(response.statusCode).toBe(400);
    const body = response.json<{ code: string; details: Record<string, string> }>();
    expect(body.code).toBe('VALIDATION_ERROR');
    expect(body.details.startDate).toBeDefined();
  });

  it('cree un element dans chacune des cinq autres collections', async () => {
    const alice = await signUp(ALICE_EMAIL);

    const cases: { path: string; payload: Record<string, unknown> }[] = [
      { path: 'educations', payload: { school: 'Université', degree: 'Master', startDate: '2020-09-01', endDate: '2023-06-30' } },
      { path: 'skills', payload: { name: 'TypeScript' } },
      { path: 'languages', payload: { name: 'Anglais', level: 'B2' } },
      { path: 'certifications', payload: { name: 'AWS', issuer: 'Amazon', issuedAt: '2024-05-01' } },
      { path: 'projects', payload: { name: 'JobTrack' } },
    ];

    for (const { path, payload } of cases) {
      const created = await app.inject({
        method: 'POST',
        url: `/api/v1/profile/${path}`,
        headers: as(alice),
        payload,
      });
      expect(created.statusCode).toBe(201);

      const list = await app.inject({ method: 'GET', url: `/api/v1/profile/${path}`, headers: as(alice) });
      expect(list.statusCode).toBe(200);
      expect(list.json<unknown[]>()).toHaveLength(1);
    }

    const certifications = await app.inject({ method: 'GET', url: '/api/v1/profile/certifications', headers: as(alice) });
    expect(certifications.json<{ issuedAt: string }[]>()[0]?.issuedAt).toBe('2024-05-01');
  });

  it('lit et met a jour les preferences', async () => {
    const alice = await signUp(ALICE_EMAIL);

    const initial = await app.inject({ method: 'GET', url: '/api/v1/profile/preferences', headers: as(alice) });
    expect(initial.statusCode).toBe(200);
    const initialBody = initial.json<{ searchRadiusKm: number; currency: string }>();
    expect(initialBody.searchRadiusKm).toBe(25);
    expect(initialBody.currency).toBe('EUR');

    const update = await app.inject({
      method: 'PATCH',
      url: '/api/v1/profile/preferences',
      headers: as(alice),
      payload: {
        desiredRoles: ['Dev'],
        desiredCategories: [],
        salaryMin: 30000,
        salaryMax: 45000,
        locations: ['Metz'],
        remoteModes: ['HYBRID'],
        contractTypes: ['CDI'],
        searchRadiusKm: 50,
      },
    });
    expect(update.statusCode).toBe(200);
    const updated = update.json<{
      desiredRoles: string[];
      salaryMin: number;
      salaryMax: number;
      locations: string[];
      remoteModes: string[];
      contractTypes: string[];
      searchRadiusKm: number;
    }>();
    expect(updated.desiredRoles).toEqual(['Dev']);
    expect(updated.salaryMin).toBe(30000);
    expect(updated.salaryMax).toBe(45000);
    expect(updated.locations).toEqual(['Metz']);
    expect(updated.remoteModes).toEqual(['HYBRID']);
    expect(updated.contractTypes).toEqual(['CDI']);
    expect(updated.searchRadiusKm).toBe(50);

    const invalid = await app.inject({
      method: 'PATCH',
      url: '/api/v1/profile/preferences',
      headers: as(alice),
      payload: {
        desiredRoles: [],
        desiredCategories: [],
        locations: [],
        remoteModes: [],
        contractTypes: [],
        salaryMin: 50000,
        salaryMax: 40000,
      },
    });
    expect(invalid.statusCode).toBe(400);
  });

  it('exige une session et un jeton csrf sur le profil', async () => {
    const noSession = await app.inject({ method: 'GET', url: '/api/v1/profile' });
    expect(noSession.statusCode).toBe(401);

    const alice = await signUp(ALICE_EMAIL);
    const noCsrf = await app.inject({
      method: 'PATCH',
      url: '/api/v1/profile',
      headers: { cookie: alice.cookie },
      payload: { firstName: 'Alice', lastName: 'B' },
    });
    expect(noCsrf.statusCode).toBe(403);
    expect(noCsrf.json<{ code: string }>().code).toBe('CSRF_MISMATCH');
  });
});
