import type { NestFastifyApplication } from '@nestjs/platform-fastify';
import { Test } from '@nestjs/testing';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { AppModule } from '../../app.module';
import { configureApp, createAdapter } from '../../app.setup';
import { PrismaService } from '../../common/prisma.service';
import { RedisService } from '../../common/redis.service';
import { SessionService } from './session.service';

let app: NestFastifyApplication;
let prisma: PrismaService;
let redis: RedisService;

const USER = {
  email: `e2e-${process.pid}@jobtrack.local`,
  password: 'motdepasse-solide-2026',
  firstName: 'E2E',
  lastName: 'Test',
};

async function clearRateLimits(): Promise<void> {
  const keys = await redis.client.keys('ratelimit:*');
  if (keys.length > 0) await redis.client.del(...keys);
}

async function clearUsers(): Promise<void> {
  // Uniquement les comptes e2e : jamais `endsWith('@jobtrack.local')`, qui effacerait le seed.
  const users = await prisma.user.findMany({
    where: { email: { startsWith: 'e2e-' } },
    select: { id: true },
  });
  // Les sessions Redis ne sont pas liées à la suppression Postgres : il faut les détruire explicitement.
  const sessions = app.get(SessionService);
  for (const user of users) {
    await sessions.destroyAllForUser(user.id);
  }
  await prisma.user.deleteMany({ where: { email: { startsWith: 'e2e-' } } });
}

beforeAll(async () => {
  const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
  app = moduleRef.createNestApplication<NestFastifyApplication>(createAdapter());
  await configureApp(app); // helmet, cookies, CORS, préfixe, filtre : identique au bootstrap
  await app.init();
  await app.getHttpAdapter().getInstance().ready();

  prisma = app.get(PrismaService);
  redis = app.get(RedisService);
});

beforeEach(async () => {
  await clearUsers();
  await clearRateLimits(); // les inscriptions répétées des tests dépasseraient la limite par IP
});

afterAll(async () => {
  await clearUsers();
  await clearRateLimits();
  await app.close();
});

function cookiesFrom(headers: Record<string, unknown>): string {
  const raw = headers['set-cookie'];
  const list = Array.isArray(raw) ? raw.map(String) : [String(raw)];
  return list.map((entry) => entry.split(';')[0]).join('; ');
}

function csrfFrom(cookieHeader: string): string {
  return /jt_csrf=([^;]+)/.exec(cookieHeader)?.[1] ?? '';
}

async function registerUser(email = USER.email) {
  const response = await app.inject({
    method: 'POST',
    url: '/api/v1/auth/register',
    payload: { ...USER, email },
  });
  const cookieHeader = cookiesFrom(response.headers);
  return { response, cookieHeader, csrf: csrfFrom(cookieHeader) };
}

describe('Authentification', () => {
  it('laisse /health public', async () => {
    const response = await app.inject({ method: 'GET', url: '/api/v1/health' });
    expect(response.statusCode).toBe(200);
  });

  it('inscrit un utilisateur et pose un cookie de session httpOnly', async () => {
    const { response, cookieHeader } = await registerUser();

    expect(response.statusCode).toBe(201);
    expect(response.json<{ email: string }>().email).toBe(USER.email);

    const setCookie = String(response.headers['set-cookie']);
    expect(setCookie).toContain('HttpOnly');
    expect(setCookie).toContain('SameSite=Lax');
    expect(cookieHeader).toContain('jt_session=');
    expect(cookieHeader).toContain('jt_csrf=');
  });

  it('ne renvoie jamais le hachage du mot de passe', async () => {
    const { response } = await registerUser();
    expect(JSON.stringify(response.json())).not.toContain('argon2');
  });

  it('refuse un email deja pris avec un message lisible', async () => {
    await registerUser();
    const second = await app.inject({ method: 'POST', url: '/api/v1/auth/register', payload: USER });

    expect(second.statusCode).toBe(409);
    expect(second.json<{ message: string }>().message).toBe(
      'Un compte existe déjà avec cette adresse email.',
    );
  });

  it('refuse un mot de passe trop court avec le detail par champ', async () => {
    const response = await app.inject({
      method: 'POST',
      url: '/api/v1/auth/register',
      payload: { ...USER, password: 'court' },
    });

    expect(response.statusCode).toBe(400);
    const body = response.json<{ code: string; details: Record<string, string> }>();
    expect(body.code).toBe('VALIDATION_ERROR');
    expect(body.details.password).toContain('12 caractères');
  });

  it('refuse l_acces a /auth/me sans session', async () => {
    const response = await app.inject({ method: 'GET', url: '/api/v1/auth/me' });

    expect(response.statusCode).toBe(401);
    expect(response.json<{ message: string }>().message).toBe(
      'Votre session a expiré. Veuillez vous reconnecter.',
    );
  });

  it('donne acces a /auth/me avec une session valide', async () => {
    const { cookieHeader } = await registerUser();

    const response = await app.inject({
      method: 'GET',
      url: '/api/v1/auth/me',
      headers: { cookie: cookieHeader },
    });

    expect(response.statusCode).toBe(200);
    expect(response.json<{ email: string }>().email).toBe(USER.email);
  });

  it('refuse une mutation authentifiee sans en-tete csrf', async () => {
    const { cookieHeader } = await registerUser();

    const response = await app.inject({
      method: 'POST',
      url: '/api/v1/auth/logout',
      headers: { cookie: cookieHeader },
    });

    expect(response.statusCode).toBe(403);
    expect(response.json<{ code: string }>().code).toBe('CSRF_MISMATCH');
  });

  it('deconnecte et invalide la session', async () => {
    const { cookieHeader, csrf } = await registerUser();

    const logout = await app.inject({
      method: 'POST',
      url: '/api/v1/auth/logout',
      headers: { cookie: cookieHeader, 'x-csrf-token': csrf },
    });
    expect(logout.statusCode).toBe(204);

    const after = await app.inject({
      method: 'GET',
      url: '/api/v1/auth/me',
      headers: { cookie: cookieHeader },
    });
    expect(after.statusCode).toBe(401);
  });

  it('liste les sessions actives et revoque une session', async () => {
    const first = await registerUser();
    const login = await app.inject({
      method: 'POST',
      url: '/api/v1/auth/login',
      payload: { email: USER.email, password: USER.password },
      headers: { 'user-agent': 'second-appareil' },
    });
    expect(login.statusCode).toBe(200);
    const secondCookies = cookiesFrom(login.headers);
    const secondCsrf = csrfFrom(secondCookies);

    const list = await app.inject({
      method: 'GET',
      url: '/api/v1/auth/sessions',
      headers: { cookie: secondCookies },
    });
    expect(list.statusCode).toBe(200);
    const sessions = list.json<{ id: string; current: boolean; userAgent: string | null }[]>();
    expect(sessions).toHaveLength(2);
    const current = sessions.find((session) => session.current);
    expect(current?.userAgent).toBe('second-appareil');
    const other = sessions.find((session) => !session.current);

    const revoke = await app.inject({
      method: 'DELETE',
      url: `/api/v1/auth/sessions/${other?.id ?? ''}`,
      headers: { cookie: secondCookies, 'x-csrf-token': secondCsrf },
    });
    expect(revoke.statusCode).toBe(204);

    const revoked = await app.inject({
      method: 'GET',
      url: '/api/v1/auth/me',
      headers: { cookie: first.cookieHeader },
    });
    expect(revoked.statusCode).toBe(401);

    const unknown = await app.inject({
      method: 'DELETE',
      url: `/api/v1/auth/sessions/${'a'.repeat(43)}`,
      headers: { cookie: secondCookies, 'x-csrf-token': secondCsrf },
    });
    expect(unknown.statusCode).toBe(404);
  });

  it('bloque apres cinq tentatives de connexion echouees', async () => {
    await registerUser();

    for (let attempt = 0; attempt < 5; attempt += 1) {
      await app.inject({
        method: 'POST',
        url: '/api/v1/auth/login',
        payload: { email: USER.email, password: 'mauvais-mot-de-passe' },
      });
    }

    const blocked = await app.inject({
      method: 'POST',
      url: '/api/v1/auth/login',
      payload: { email: USER.email, password: USER.password },
    });

    expect(blocked.statusCode).toBe(429);
    expect(blocked.json<{ message: string }>().message).toBe(
      'Trop de tentatives. Réessayez dans quelques minutes.',
    );
  });
});
