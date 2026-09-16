import { UnauthorizedException } from '@nestjs/common';
import type { NestFastifyApplication } from '@nestjs/platform-fastify';
import { Test } from '@nestjs/testing';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { AppModule } from '../../app.module';
import { configureApp, createAdapter } from '../../app.setup';
import { PrismaService } from '../../common/prisma.service';
import { RedisService } from '../../common/redis.service';
import { env } from '../../config/env';
import { GoogleService, type GoogleProfile } from './google.service';
import { PasswordResetService } from './password-reset.service';
import { SessionService } from './session.service';

let app: NestFastifyApplication;
let prisma: PrismaService;
let redis: RedisService;

// Remplace le GoogleService (null en local/CI, GOOGLE_* absent) : les tests e2e ne doivent
// jamais appeler les vrais points de terminaison Google.
const fakeGoogle = {
  buildAuthUrl: (state: string, codeChallenge: string) =>
    `https://accounts.google.com/o/oauth2/v2/auth?state=${state}&code_challenge=${codeChallenge}`,
  exchangeCode: vi.fn<(code: string, codeVerifier: string) => Promise<GoogleProfile>>(),
};

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

async function clearOAuthStateMarks(): Promise<void> {
  const keys = await redis.client.keys('oauth_state_used:*');
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
    await clearResetToken(user.id);
  }
  await prisma.user.deleteMany({ where: { email: { startsWith: 'e2e-' } } });
}

/** Détruit le jeton de réinitialisation en cours pour un utilisateur e2e, s'il existe. */
async function clearResetToken(userId: string): Promise<void> {
  const indexKey = `pwreset_user:${userId}`;
  const key = await redis.client.getdel(indexKey);
  if (key) await redis.client.del(key);
}

beforeAll(async () => {
  const moduleRef = await Test.createTestingModule({ imports: [AppModule] })
    .overrideProvider(GoogleService)
    .useValue(fakeGoogle)
    .compile();
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
  await clearOAuthStateMarks(); // sinon un state e2e réutilisé d'un test à l'autre serait déjà "consommé"
  fakeGoogle.exchangeCode.mockReset();
});

afterAll(async () => {
  await clearUsers();
  await clearRateLimits();
  await clearOAuthStateMarks();
  await app.close();
});

function rawCookies(headers: Record<string, unknown>): string[] {
  const raw = headers['set-cookie'];
  if (raw === undefined) return [];
  if (Array.isArray(raw)) return raw.map(String);
  // Fastify ne pose ce header qu'en string ou string[] ; tout autre cas (jamais rencontré
  // en pratique) est traité comme absent plutôt que de stringifier une valeur ambiguë.
  return typeof raw === 'string' ? [raw] : [];
}

function cookiesFrom(headers: Record<string, unknown>): string {
  return rawCookies(headers)
    .map((entry) => entry.split(';')[0])
    .join('; ');
}

function findCookie(headers: Record<string, unknown>, name: string): string {
  const entry = rawCookies(headers).find((cookie) => cookie.startsWith(`${name}=`));
  if (!entry) throw new Error(`Cookie ${name} absent de set-cookie.`);
  return entry;
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

    const sessionCookie = findCookie(response.headers, 'jt_session');
    const csrfCookie = findCookie(response.headers, 'jt_csrf');

    // Session : httpOnly, immunisee au vol par XSS.
    expect(sessionCookie).toContain('HttpOnly');
    // CSRF : volontairement lisible en JavaScript, le frontend doit le recopier en en-tete.
    expect(csrfCookie).not.toContain('HttpOnly');
    // Meme duree de vie que la session Redis (30 jours), meme politique SameSite.
    for (const cookie of [sessionCookie, csrfCookie]) {
      expect(cookie).toContain('Max-Age=2592000');
      expect(cookie).toContain('SameSite=Lax');
      // Environnement de test = NODE_ENV != production : pas de flag Secure (HTTP local).
      expect(cookie).not.toContain('Secure');
    }

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

  it('refuse un mauvais mot de passe avec le meme message qu_un compte inconnu', async () => {
    await registerUser();

    const wrongPassword = await app.inject({
      method: 'POST',
      url: '/api/v1/auth/login',
      payload: { email: USER.email, password: 'mauvais-mot-de-passe' },
    });
    const unknownAccount = await app.inject({
      method: 'POST',
      url: '/api/v1/auth/login',
      payload: { email: `e2e-inconnu-${process.pid}@jobtrack.local`, password: USER.password },
    });

    expect(wrongPassword.statusCode).toBe(401);
    expect(unknownAccount.statusCode).toBe(401);
    expect(wrongPassword.json()).toEqual(unknownAccount.json());
  });

  it('refuse un corps json malforme', async () => {
    const response = await app.inject({
      method: 'POST',
      url: '/api/v1/auth/login',
      headers: { 'content-type': 'application/json' },
      payload: '{"email":',
    });

    expect(response.statusCode).toBe(400);
    expect(response.json<{ code: string }>().code).toBe('BAD_REQUEST');
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

  it('la deconnexion expire les deux cookies', async () => {
    const { cookieHeader, csrf } = await registerUser();

    const logout = await app.inject({
      method: 'POST',
      url: '/api/v1/auth/logout',
      headers: { cookie: cookieHeader, 'x-csrf-token': csrf },
    });
    expect(logout.statusCode).toBe(204);

    const sessionCookie = findCookie(logout.headers, 'jt_session');
    const csrfCookie = findCookie(logout.headers, 'jt_csrf');
    // @fastify/cookie expire une cookie effacee via `Expires` place dans le passe (pas Max-Age=0).
    expect(sessionCookie).toContain('Expires=Thu, 01 Jan 1970');
    expect(csrfCookie).toContain('Expires=Thu, 01 Jan 1970');
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

    // Le handle exposé n'est jamais l'identifiant brut de session (celui du cookie
    // httpOnly `jt_session`) : une fuite XSS de cette liste ne doit livrer aucun jeton.
    const sessionCookieValue = /jt_session=([^;]+)/.exec(findCookie(login.headers, 'jt_session'))?.[1] ?? '';
    expect(current?.id).toHaveLength(43);
    expect(current?.id).not.toBe(sessionCookieValue);

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

describe('Réinitialisation du mot de passe', () => {
  it('repond pareil que le compte existe ou non', async () => {
    await registerUser();
    const known = await app.inject({ method: 'POST', url: '/api/v1/auth/forgot-password', payload: { email: USER.email } });
    const unknown = await app.inject({ method: 'POST', url: '/api/v1/auth/forgot-password', payload: { email: `inconnu-${process.pid}@jobtrack.local` } });

    expect(known.statusCode).toBe(202);
    expect(unknown.statusCode).toBe(202);
    expect(known.json()).toEqual(unknown.json());
  });

  it('refuse un jeton invalide', async () => {
    const response = await app.inject({
      method: 'POST',
      url: '/api/v1/auth/reset-password',
      payload: { token: 'a'.repeat(43), password: 'nouveau-mot-de-passe-2026' },
    });

    expect(response.statusCode).toBe(400);
    expect(response.json<{ code: string }>().code).toBe('INVALID_RESET_TOKEN');
  });

  it('reinitialise le mot de passe, ferme les sessions et refuse le second usage', async () => {
    const { cookieHeader } = await registerUser();
    const user = await prisma.user.findUniqueOrThrow({ where: { email: USER.email } });
    // Le lien n'est que journalisé dans cette tranche : on émet le jeton directement.
    const token = await app.get(PasswordResetService).issue(user.id);

    const reset = await app.inject({
      method: 'POST',
      url: '/api/v1/auth/reset-password',
      payload: { token, password: 'nouveau-mot-de-passe-2026' },
    });
    expect(reset.statusCode).toBe(204);

    const oldSession = await app.inject({ method: 'GET', url: '/api/v1/auth/me', headers: { cookie: cookieHeader } });
    expect(oldSession.statusCode).toBe(401);

    const oldPassword = await app.inject({ method: 'POST', url: '/api/v1/auth/login', payload: { email: USER.email, password: USER.password } });
    expect(oldPassword.statusCode).toBe(401);

    const newPassword = await app.inject({ method: 'POST', url: '/api/v1/auth/login', payload: { email: USER.email, password: 'nouveau-mot-de-passe-2026' } });
    expect(newPassword.statusCode).toBe(200);

    const again = await app.inject({ method: 'POST', url: '/api/v1/auth/reset-password', payload: { token, password: 'encore-un-autre-2026' } });
    expect(again.statusCode).toBe(400);
  });

  it('la reinitialisation debloque la connexion', async () => {
    await registerUser();

    for (let attempt = 0; attempt < 5; attempt += 1) {
      await app.inject({
        method: 'POST',
        url: '/api/v1/auth/login',
        payload: { email: USER.email, password: 'mauvais-mot-de-passe' },
      });
    }

    const user = await prisma.user.findUniqueOrThrow({ where: { email: USER.email } });
    const token = await app.get(PasswordResetService).issue(user.id);

    const reset = await app.inject({
      method: 'POST',
      url: '/api/v1/auth/reset-password',
      payload: { token, password: 'nouveau-mot-de-passe-2026' },
    });
    expect(reset.statusCode).toBe(204);

    const login = await app.inject({
      method: 'POST',
      url: '/api/v1/auth/login',
      payload: { email: USER.email, password: 'nouveau-mot-de-passe-2026' },
    });
    expect(login.statusCode).toBe(200);
  });
});

describe('Changement de mot de passe', () => {
  it('refuse un mot de passe actuel incorrect', async () => {
    const { cookieHeader, csrf } = await registerUser();

    const response = await app.inject({
      method: 'PATCH',
      url: '/api/v1/auth/password',
      payload: { currentPassword: 'mauvais-mot-de-passe', newPassword: 'nouveau-mot-de-passe-2026' },
      headers: { cookie: cookieHeader, 'x-csrf-token': csrf },
    });

    expect(response.statusCode).toBe(400);
    expect(response.json<{ code: string }>().code).toBe('INVALID_CURRENT_PASSWORD');
  });

  it('exige le jeton csrf', async () => {
    const { cookieHeader } = await registerUser();

    const response = await app.inject({
      method: 'PATCH',
      url: '/api/v1/auth/password',
      payload: { currentPassword: USER.password, newPassword: 'nouveau-mot-de-passe-2026' },
      headers: { cookie: cookieHeader },
    });

    expect(response.statusCode).toBe(403);
    expect(response.json<{ code: string }>().code).toBe('CSRF_MISMATCH');
  });

  it('refuse un nouveau mot de passe identique a l_actuel', async () => {
    const { cookieHeader, csrf } = await registerUser();

    const response = await app.inject({
      method: 'PATCH',
      url: '/api/v1/auth/password',
      payload: { currentPassword: USER.password, newPassword: USER.password },
      headers: { cookie: cookieHeader, 'x-csrf-token': csrf },
    });

    expect(response.statusCode).toBe(400);
    const body = response.json<{ code: string; details?: Record<string, string> }>();
    expect(body.code).toBe('VALIDATION_ERROR');
    expect(body.details?.newPassword).toBeTruthy();
  });

  it('refuse un nouveau mot de passe trop court', async () => {
    const { cookieHeader, csrf } = await registerUser();

    const response = await app.inject({
      method: 'PATCH',
      url: '/api/v1/auth/password',
      payload: { currentPassword: USER.password, newPassword: 'court' },
      headers: { cookie: cookieHeader, 'x-csrf-token': csrf },
    });

    expect(response.statusCode).toBe(400);
    expect(response.json<{ code: string }>().code).toBe('VALIDATION_ERROR');
  });

  it('renvoie un 503 explicite si la fermeture des autres sessions echoue', async () => {
    const { cookieHeader, csrf } = await registerUser();
    // Le mot de passe est déjà changé en base à ce stade (voir AuthService.changePassword) :
    // une panne Redis à l'étape suivante doit remonter un 503 explicite, jamais un succès muet.
    const spy = vi
      .spyOn(app.get(SessionService), 'destroyAllForUser')
      .mockRejectedValueOnce(new Error('redis indisponible'));

    const response = await app.inject({
      method: 'PATCH',
      url: '/api/v1/auth/password',
      payload: { currentPassword: USER.password, newPassword: 'nouveau-mot-de-passe-2026' },
      headers: { cookie: cookieHeader, 'x-csrf-token': csrf },
    });

    expect(response.statusCode).toBe(503);
    expect(response.json<{ code: string }>().code).toBe('SERVICE_UNAVAILABLE');
    spy.mockRestore();

    // Le nouveau mot de passe fonctionne malgré l'échec de la fermeture des autres sessions.
    const login = await app.inject({
      method: 'POST',
      url: '/api/v1/auth/login',
      payload: { email: USER.email, password: 'nouveau-mot-de-passe-2026' },
    });
    expect(login.statusCode).toBe(200);
  });

  it('change le mot de passe et deconnecte les autres appareils', async () => {
    // Appareil A : session ouverte à l'inscription.
    const deviceA = await registerUser();

    // Appareil B : deuxième connexion, même compte.
    const loginB = await app.inject({
      method: 'POST',
      url: '/api/v1/auth/login',
      payload: { email: USER.email, password: USER.password },
      headers: { 'user-agent': 'appareil-b' },
    });
    expect(loginB.statusCode).toBe(200);
    const deviceBCookies = cookiesFrom(loginB.headers);

    const change = await app.inject({
      method: 'PATCH',
      url: '/api/v1/auth/password',
      payload: { currentPassword: USER.password, newPassword: 'nouveau-mot-de-passe-2026' },
      headers: { cookie: deviceA.cookieHeader, 'x-csrf-token': deviceA.csrf },
    });
    expect(change.statusCode).toBe(204);

    // Appareil A (celui qui a fait le changement) reste connecté.
    const meA = await app.inject({ method: 'GET', url: '/api/v1/auth/me', headers: { cookie: deviceA.cookieHeader } });
    expect(meA.statusCode).toBe(200);

    // Appareil B a été déconnecté.
    const meB = await app.inject({ method: 'GET', url: '/api/v1/auth/me', headers: { cookie: deviceBCookies } });
    expect(meB.statusCode).toBe(401);

    // Le nouveau mot de passe fonctionne, l'ancien est refusé.
    const newLogin = await app.inject({
      method: 'POST',
      url: '/api/v1/auth/login',
      payload: { email: USER.email, password: 'nouveau-mot-de-passe-2026' },
    });
    expect(newLogin.statusCode).toBe(200);

    const oldLogin = await app.inject({
      method: 'POST',
      url: '/api/v1/auth/login',
      payload: { email: USER.email, password: USER.password },
    });
    expect(oldLogin.statusCode).toBe(401);

    // La session de l'appareil A n'a pas changé d'identifiant (seuls les autres appareils
    // ont été fermés) : son jeton CSRF d'origine, émis à l'inscription, doit donc encore
    // être accepté pour une mutation sur cette même session.
    const logoutA = await app.inject({
      method: 'POST',
      url: '/api/v1/auth/logout',
      headers: { cookie: deviceA.cookieHeader, 'x-csrf-token': deviceA.csrf },
    });
    expect(logoutA.statusCode).toBe(204);
  });
});

describe('Connexion Google', () => {
  const GOOGLE_PROFILE: GoogleProfile = {
    providerAccountId: 'sub-e2e',
    email: `e2e-google-${process.pid}@jobtrack.local`,
    firstName: 'Gé',
    lastName: 'Oauth',
  };

  /** Démarre le flux : renvoie le cookie de state à relayer et le state extrait de l'url. */
  async function startFlow() {
    const response = await app.inject({ method: 'GET', url: '/api/v1/auth/google' });
    const cookieHeader = cookiesFrom(response.headers);
    const state = new URL(response.json<{ url: string }>().url).searchParams.get('state') ?? '';
    return { response, cookieHeader, state };
  }

  it('demarre le flux google avec un state signe', async () => {
    const { response, cookieHeader, state } = await startFlow();

    expect(response.statusCode).toBe(200);
    expect(response.json<{ url: string }>().url).toContain('state=');
    expect(state).not.toBe('');

    const stateCookie = findCookie(response.headers, 'jt_oauth_state');
    expect(stateCookie).toContain('HttpOnly');
    expect(cookieHeader).toContain('jt_oauth_state=');
  });

  it('refuse un callback dont le state ne correspond pas', async () => {
    const { cookieHeader } = await startFlow();

    const response = await app.inject({
      method: 'GET',
      url: '/api/v1/auth/google/callback?code=x&state=autre',
      headers: { cookie: cookieHeader },
    });

    expect(response.statusCode).toBe(302);
    expect(response.headers.location).toBe(`${env.WEB_ORIGIN}/login?error=google`);
    expect(fakeGoogle.exchangeCode).not.toHaveBeenCalled();
  });

  it('cree le compte et ouvre une session au callback', async () => {
    const { cookieHeader, state } = await startFlow();
    fakeGoogle.exchangeCode.mockResolvedValueOnce(GOOGLE_PROFILE);

    const callback = await app.inject({
      method: 'GET',
      url: `/api/v1/auth/google/callback?code=code-e2e&state=${state}`,
      headers: { cookie: cookieHeader },
    });

    expect(callback.statusCode).toBe(302);
    expect(callback.headers.location).toBe(`${env.WEB_ORIGIN}/profile`);
    expect(findCookie(callback.headers, 'jt_session')).toContain('jt_session=');
    expect(findCookie(callback.headers, 'jt_csrf')).toContain('jt_csrf=');
    // Le cookie de state, à usage unique, ne doit pas survivre au callback.
    expect(findCookie(callback.headers, 'jt_oauth_state')).toContain('Expires=Thu, 01 Jan 1970');

    const newCookies = cookiesFrom(callback.headers);
    const me = await app.inject({ method: 'GET', url: '/api/v1/auth/me', headers: { cookie: newCookies } });
    expect(me.statusCode).toBe(200);
    expect(me.json<{ email: string }>().email).toBe(GOOGLE_PROFILE.email);
  });

  it('redirige vers la page de connexion quand google refuse', async () => {
    const { cookieHeader, state } = await startFlow();
    fakeGoogle.exchangeCode.mockRejectedValueOnce(
      new UnauthorizedException({
        code: 'GOOGLE_AUTH_FAILED',
        message: 'La connexion Google a échoué. Veuillez réessayer.',
      }),
    );

    const response = await app.inject({
      method: 'GET',
      url: `/api/v1/auth/google/callback?code=code-e2e&state=${state}`,
      headers: { cookie: cookieHeader },
    });

    expect(response.statusCode).toBe(302);
    expect(response.headers.location).toBe(`${env.WEB_ORIGIN}/login?error=google`);
    expect(rawCookies(response.headers).some((cookie) => cookie.startsWith('jt_session='))).toBe(false);
  });

  it('refuse un callback sans cookie de state', async () => {
    const response = await app.inject({
      method: 'GET',
      url: '/api/v1/auth/google/callback?code=code-e2e&state=quelconque',
    });

    expect(response.statusCode).toBe(302);
    expect(response.headers.location).toBe(`${env.WEB_ORIGIN}/login?error=google`);
    expect(fakeGoogle.exchangeCode).not.toHaveBeenCalled();
  });

  it('refuse de rejouer un callback', async () => {
    const { cookieHeader, state } = await startFlow();
    fakeGoogle.exchangeCode.mockResolvedValueOnce(GOOGLE_PROFILE);
    const url = `/api/v1/auth/google/callback?code=code-e2e&state=${state}`;

    const first = await app.inject({ method: 'GET', url, headers: { cookie: cookieHeader } });
    expect(first.statusCode).toBe(302);
    expect(first.headers.location).toBe(`${env.WEB_ORIGIN}/profile`);

    // Rejeu : on renvoie volontairement le même cookie de state (déjà expiré côté navigateur
    // par la réponse précédente) pour simuler un callback intercepté puis rejoué.
    const replay = await app.inject({ method: 'GET', url, headers: { cookie: cookieHeader } });
    expect(replay.statusCode).toBe(302);
    expect(replay.headers.location).toBe(`${env.WEB_ORIGIN}/login?error=google`);
    expect(fakeGoogle.exchangeCode).toHaveBeenCalledTimes(1);
  });

  it('relie un compte google a un utilisateur verifie du meme email', async () => {
    const email = `e2e-google-verifie-${process.pid}@jobtrack.local`;
    await registerUser(email);
    const registered = await prisma.user.findUniqueOrThrow({ where: { email } });
    await prisma.user.update({ where: { id: registered.id }, data: { emailVerifiedAt: new Date() } });

    const { cookieHeader, state } = await startFlow();
    fakeGoogle.exchangeCode.mockResolvedValueOnce({
      providerAccountId: `sub-verifie-${process.pid}`,
      email,
      firstName: 'Gé',
      lastName: 'Oauth',
    });

    const callback = await app.inject({
      method: 'GET',
      url: `/api/v1/auth/google/callback?code=code-e2e&state=${state}`,
      headers: { cookie: cookieHeader },
    });

    expect(callback.statusCode).toBe(302);
    expect(callback.headers.location).toBe(`${env.WEB_ORIGIN}/profile`);

    const me = await app.inject({
      method: 'GET',
      url: '/api/v1/auth/me',
      headers: { cookie: cookiesFrom(callback.headers) },
    });
    expect(me.statusCode).toBe(200);
    expect(me.json<{ id: string }>().id).toBe(registered.id);
  });

  it('redirige vers google_link pour un compte a mot de passe non verifie', async () => {
    const email = `e2e-google-nonverifie-${process.pid}@jobtrack.local`;
    await registerUser(email); // email jamais vérifié par défaut

    const { cookieHeader, state } = await startFlow();
    fakeGoogle.exchangeCode.mockResolvedValueOnce({
      providerAccountId: `sub-nonverifie-${process.pid}`,
      email,
      firstName: 'Gé',
      lastName: 'Oauth',
    });

    const callback = await app.inject({
      method: 'GET',
      url: `/api/v1/auth/google/callback?code=code-e2e&state=${state}`,
      headers: { cookie: cookieHeader },
    });

    expect(callback.statusCode).toBe(302);
    expect(callback.headers.location).toBe(`${env.WEB_ORIGIN}/login?error=google_link`);
  });
});

describe('Google non configure', () => {
  let unconfiguredApp: NestFastifyApplication;

  beforeAll(async () => {
    // Pas d'overrideProvider ici : GOOGLE_* est absent de l'environnement de test/CI,
    // donc AuthModule fournit un GoogleService réellement `null`.
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    unconfiguredApp = moduleRef.createNestApplication<NestFastifyApplication>(createAdapter());
    await configureApp(unconfiguredApp);
    await unconfiguredApp.init();
    await unconfiguredApp.getHttpAdapter().getInstance().ready();
  });

  afterAll(async () => {
    await unconfiguredApp.close();
  });

  it('repond 503 sans configuration google', async () => {
    const start = await unconfiguredApp.inject({ method: 'GET', url: '/api/v1/auth/google' });
    expect(start.statusCode).toBe(503);
    expect(start.json<{ code: string }>().code).toBe('GOOGLE_NOT_CONFIGURED');

    // Une navigation de navigateur ne doit jamais recevoir de JSON, même sans configuration.
    const callback = await unconfiguredApp.inject({
      method: 'GET',
      url: '/api/v1/auth/google/callback?code=x&state=y',
    });
    expect(callback.statusCode).toBe(302);
    expect(callback.headers.location).toBe(`${env.WEB_ORIGIN}/login?error=google`);
  });
});
