import { randomUUID } from 'node:crypto';
import type { NestFastifyApplication } from '@nestjs/platform-fastify';
import { Test } from '@nestjs/testing';
import type {
  ApplicationBoardDto,
  ApplicationDetailDto,
  ApplicationListResponseDto,
  ApplicationStatsDto,
  ApplicationStatus,
  JobDetailDto,
} from '@jobtrack/shared';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { AppModule } from '../../app.module';
import { configureApp, createAdapter } from '../../app.setup';
import { PrismaService } from '../../common/prisma.service';
import { rateLimitKey } from '../../common/rate-limit.guard';
import { RedisService } from '../../common/redis.service';
import { SessionService } from '../auth/session.service';

const BASE = '/api/v1/applications';

// Préfixes réservés à CETTE suite (même principe que `resume.e2e.spec.ts`) : ni les offres
// semées pour le développement (`FT-…`), ni les lignes d'une autre suite ne les portent.
// `applications.service.spec.ts` (unitaire) utilise `E2E-APP-UNIT-<pid>-`, jamais nettoyé
// ici en pratique — les deux suites s'exécutent dans deux commandes distinctes.
const TITLE_PREFIX = 'E2E-APP-';
const USER_EMAIL_PREFIX = 'e2e-app-';
const JOB_FINGERPRINT_PREFIX = 'E2E-APP-JOB-';
const EXTERNAL_ID_PREFIX = 'E2E-APP-';
// Seaux des gardes de débit posées sur les écritures (`applications.controller.ts`) : la
// création a le sien, les modifications de fiche et les déplacements Kanban chacun le leur.
const CREATE_BUCKET = 'application-create';
const CREATE_LIMIT = 60;
const WRITE_BUCKETS = ['application-write', 'application-move'];

/**
 * Jour courant **à Paris** au format `AAAA-MM-JJ` : la valeur que l'API pose sur `appliedAt`.
 * Jamais `new Date().toISOString().slice(0, 10)` (jour UTC) — entre minuit et 2 h à Paris,
 * l'UTC est encore la veille, et ces assertions échoueraient une nuit sur douze.
 */
function todayInParis(): string {
  return new Intl.DateTimeFormat('fr-CA', {
    timeZone: 'Europe/Paris',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(new Date());
}

let app: NestFastifyApplication;
let prisma: PrismaService;
let redis: RedisService;

// ---------------------------------------------------------------------------
// Nettoyage (strictement par préfixe)
// ---------------------------------------------------------------------------

async function clearJobs(): Promise<void> {
  await prisma.jobSource.deleteMany({ where: { externalId: { startsWith: EXTERNAL_ID_PREFIX } } });
  await prisma.job.deleteMany({ where: { fingerprint: { startsWith: JOB_FINGERPRINT_PREFIX } } });
}

/** Les candidatures et leur historique disparaissent par cascade avec l'utilisateur ; la
 * suppression par titre couvre les lignes créées hors compte de cette suite (aucune
 * aujourd'hui), jamais celles d'un développeur. */
async function clearUsers(): Promise<void> {
  await prisma.application.deleteMany({ where: { jobTitle: { startsWith: TITLE_PREFIX } } });
  const users = await prisma.user.findMany({
    where: { email: { startsWith: USER_EMAIL_PREFIX } },
    select: { id: true },
  });
  const sessions = app.get(SessionService);
  for (const user of users) {
    await sessions.destroyAllForUser(user.id);
  }
  await prisma.user.deleteMany({ where: { email: { startsWith: USER_EMAIL_PREFIX } } });
}

/** Les seuls seaux de cette suite (`application-create`, `application-write`,
 * `application-move`) et le budget d'inscription, partagé avec les autres suites e2e du même
 * run (20 inscriptions/h par IP) — jamais un `ratelimit:*` en bloc, qui toucherait les
 * compteurs d'un développeur. */
async function clearRateLimits(): Promise<void> {
  const buckets = [CREATE_BUCKET, ...WRITE_BUCKETS];
  const perBucket = await Promise.all(buckets.map((bucket) => redis.client.keys(`ratelimit:${bucket}:*`)));
  const keys = [...perBucket.flat(), ...(await redis.client.keys('ratelimit:*auth/register*'))];
  if (keys.length > 0) await redis.client.del(...keys);
}

async function clearAll(): Promise<void> {
  await clearUsers();
  await clearJobs();
  await clearRateLimits();
}

// ---------------------------------------------------------------------------
// Sessions et requêtes
// ---------------------------------------------------------------------------

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
  email: string;
  cookieHeader: string;
  csrf: string;
}

async function registerUser(): Promise<Session> {
  const email = `${USER_EMAIL_PREFIX}${process.pid}-${randomUUID()}@jobtrack.local`;
  const response = await app.inject({
    method: 'POST',
    url: '/api/v1/auth/register',
    payload: { email, password: 'motdepasse-solide-2026', firstName: 'Camille', lastName: 'Martin' },
  });
  const cookieHeader = cookiesFrom(response.headers);
  return { userId: response.json<{ id: string }>().id, email, cookieHeader, csrf: csrfFrom(cookieHeader) };
}

function authHeaders(session: Session): Record<string, string> {
  return { cookie: session.cookieHeader, 'x-csrf-token': session.csrf };
}

interface ApiErrorBody {
  code: string;
  message?: string;
  details?: Record<string, string>;
}

function errorBody(response: { body: string }): ApiErrorBody {
  return JSON.parse(response.body) as ApiErrorBody;
}

async function createJobRow(
  overrides: { title?: string; company?: string; applyUrl?: string | null } = {},
): Promise<string> {
  const externalId = `${EXTERNAL_ID_PREFIX}${randomUUID()}`;
  const publishedAt = new Date();
  const job = await prisma.job.create({
    data: {
      fingerprint: `${JOB_FINGERPRINT_PREFIX}${randomUUID()}`,
      title: overrides.title ?? `${TITLE_PREFIX}Ingenieure logicielle`,
      company: overrides.company ?? 'Solaris Ingénierie',
      description: "Poste d'ingénieure logicielle.",
      locationLabel: 'Metz (57)',
      contractLabel: 'CDI',
      salaryMinAnnual: 45000,
      salaryMaxAnnual: 55000,
      publishedAt,
      sources: {
        create: {
          source: 'FRANCE_TRAVAIL',
          externalId,
          url: `https://candidat.francetravail.fr/offres/${externalId}`,
          applyUrl: overrides.applyUrl === undefined ? 'https://exemple.test/postuler' : overrides.applyUrl,
          publishedAt,
        },
      },
    },
  });
  return job.id;
}

interface CreatePayload {
  [key: string]: unknown;
}

function manualPayload(overrides: CreatePayload = {}): CreatePayload {
  return { jobTitle: `${TITLE_PREFIX}Analyste`, company: 'Société Générale', source: 'LINKEDIN', ...overrides };
}

async function post(session: Session, payload: CreatePayload): Promise<{ statusCode: number; body: string }> {
  const response = await app.inject({ method: 'POST', url: BASE, headers: authHeaders(session), payload });
  return { statusCode: response.statusCode, body: response.body };
}

async function createApplication(session: Session, payload: CreatePayload): Promise<ApplicationDetailDto> {
  const response = await post(session, payload);
  if (response.statusCode !== 201) {
    throw new Error(`Création refusée (${response.statusCode}) : ${response.body}`);
  }
  return JSON.parse(response.body) as ApplicationDetailDto;
}

async function getDetail(session: Session, id: string): Promise<ApplicationDetailDto> {
  const response = await app.inject({ method: 'GET', url: `${BASE}/${id}`, headers: authHeaders(session) });
  return JSON.parse(response.body) as ApplicationDetailDto;
}

async function move(
  session: Session,
  id: string,
  status: ApplicationStatus,
  position: number,
): Promise<{ statusCode: number; body: string }> {
  const response = await app.inject({
    method: 'PATCH',
    url: `${BASE}/${id}/move`,
    headers: authHeaders(session),
    payload: { status, position },
  });
  return { statusCode: response.statusCode, body: response.body };
}

async function boardOf(session: Session): Promise<ApplicationBoardDto> {
  const response = await app.inject({ method: 'GET', url: `${BASE}/board`, headers: authHeaders(session) });
  return JSON.parse(response.body) as ApplicationBoardDto;
}

/** Positions telles que le Kanban les sert, colonne par colonne. */
function positionsOf(board: ApplicationBoardDto, status: ApplicationStatus): number[] {
  return board.columns[status].map((card) => card.position);
}

beforeAll(async () => {
  const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
  app = moduleRef.createNestApplication<NestFastifyApplication>(createAdapter());
  await configureApp(app);
  await app.init();
  await app.getHttpAdapter().getInstance().ready();

  prisma = app.get(PrismaService);
  redis = app.get(RedisService);
});

beforeEach(async () => {
  await clearAll();
});

afterAll(async () => {
  await clearAll();
  await app.close();
});

describe('POST /applications', () => {
  it('cree une candidature depuis une offre avec son instantane et l_evenement CREATED', async () => {
    const session = await registerUser();
    const jobId = await createJobRow();

    const response = await post(session, { jobId });

    expect(response.statusCode).toBe(201);
    const body = JSON.parse(response.body) as ApplicationDetailDto;
    expect(body.jobId).toBe(jobId);
    expect(body.jobTitle).toBe(`${TITLE_PREFIX}Ingenieure logicielle`);
    expect(body.company).toBe('Solaris Ingénierie');
    expect(body.locationLabel).toBe('Metz (57)');
    expect(body.salaryLabel).toBe('45–55 k€');
    expect(body.source).toBe('FRANCE_TRAVAIL');
    expect(body.sourceUrl).toBe('https://exemple.test/postuler');
    expect(body.status).toBe('TO_APPLY');
    expect(body.appliedAt).toBeNull();
    expect(body.events.map((event) => event.type)).toEqual(['CREATED']);
    expect(body.job?.id).toBe(jobId);
  });

  it('cree une candidature manuelle envoyee et la date du jour', async () => {
    const session = await registerUser();

    const body = await createApplication(
      session,
      manualPayload({ status: 'INTERVIEW', notes: 'Entretien le 20 septembre.' }),
    );

    expect(body.jobId).toBeNull();
    expect(body.source).toBe('LINKEDIN');
    expect(body.status).toBe('INTERVIEW');
    expect(body.appliedAt).toBe(todayInParis());
    expect(body.notes).toBe('Entretien le 20 septembre.');
  });

  it('refuse une seconde candidature sur la meme offre et designe l_existante', async () => {
    const session = await registerUser();
    const jobId = await createJobRow();
    const first = await createApplication(session, { jobId });

    const response = await post(session, { jobId });

    expect(response.statusCode).toBe(409);
    const error = errorBody(response);
    expect(error.code).toBe('APPLICATION_EXISTS');
    expect(error.message).toBe('Une candidature existe déjà pour cette offre.');
    expect(error.details?.applicationId).toBe(first.id);
  });

  it('refuse une offre inconnue', async () => {
    const session = await registerUser();

    const response = await post(session, { jobId: 'offre-inexistante' });

    expect(response.statusCode).toBe(404);
    expect(errorBody(response).code).toBe('JOB_NOT_FOUND');
    expect(errorBody(response).message).toBe('Offre introuvable.');
  });

  it('refuse un lien d_offre qui n_est pas http', async () => {
    const session = await registerUser();

    const response = await post(session, manualPayload({ sourceUrl: 'javascript:alert(1)' }));

    expect(response.statusCode).toBe(400);
    expect(errorBody(response).code).toBe('VALIDATION_ERROR');
  });

  it('refuse le CV principal et un CV adapte ensemble', async () => {
    const session = await registerUser();

    const response = await post(session, manualPayload({ usedBaseResume: true, resumeId: 'cv-quelconque' }));

    expect(response.statusCode).toBe(400);
    expect(errorBody(response).code).toBe('VALIDATION_ERROR');
  });

  it('refuse un CV qui appartient a quelqu_un d_autre', async () => {
    const session = await registerUser();
    const other = await registerUser();
    const resume = await prisma.resume.create({ data: { userId: other.userId, title: `${TITLE_PREFIX}CV` } });

    const response = await post(session, manualPayload({ resumeId: resume.id }));

    expect(response.statusCode).toBe(404);
    expect(errorBody(response).code).toBe('RESUME_NOT_FOUND');
  });

  it('refuse la creation au-dela de 60 par heure', async () => {
    const session = await registerUser();
    // Le compteur est pré-rempli avec la clé exacte de `UserRateLimitGuard` plutôt que de
    // rejouer 60 créations : même seau, même fenêtre, suite bien plus rapide.
    await redis.client.set(rateLimitKey(CREATE_BUCKET, `user:${session.userId}`), String(CREATE_LIMIT), 'EX', 3600);

    const response = await post(session, manualPayload());

    expect(response.statusCode).toBe(429);
    expect(errorBody(response).code).toBe('RATE_LIMITED');
  });
});

describe('GET /applications', () => {
  it('renvoie une liste vide pour un compte neuf', async () => {
    const session = await registerUser();

    const response = await app.inject({ method: 'GET', url: BASE, headers: authHeaders(session) });

    expect(response.statusCode).toBe(200);
    const body = JSON.parse(response.body) as ApplicationListResponseDto;
    expect(body).toEqual({ items: [], page: 1, limit: 20, total: 0 });
  });

  it('filtre par onglet et cherche par poste ou entreprise', async () => {
    const session = await registerUser();
    await createApplication(session, manualPayload({ jobTitle: `${TITLE_PREFIX}Developpeuse`, status: 'APPLIED' }));
    await createApplication(session, manualPayload({ jobTitle: `${TITLE_PREFIX}Product Owner` }));

    const applied = await app.inject({
      method: 'GET',
      url: `${BASE}?tab=applied`,
      headers: authHeaders(session),
    });
    expect((JSON.parse(applied.body) as ApplicationListResponseDto).total).toBe(1);

    const searched = await app.inject({
      method: 'GET',
      url: `${BASE}?q=PRODUCT`,
      headers: authHeaders(session),
    });
    const body = JSON.parse(searched.body) as ApplicationListResponseDto;
    expect(body.total).toBe(1);
    expect(body.items[0]?.jobTitle).toBe(`${TITLE_PREFIX}Product Owner`);
  });

  it('pagine la liste', async () => {
    const session = await registerUser();
    await createApplication(session, manualPayload({ jobTitle: `${TITLE_PREFIX}Un` }));
    await createApplication(session, manualPayload({ jobTitle: `${TITLE_PREFIX}Deux` }));
    await createApplication(session, manualPayload({ jobTitle: `${TITLE_PREFIX}Trois` }));

    const response = await app.inject({
      method: 'GET',
      url: `${BASE}?page=2&limit=2`,
      headers: authHeaders(session),
    });

    const body = JSON.parse(response.body) as ApplicationListResponseDto;
    expect(body.total).toBe(3);
    expect(body.page).toBe(2);
    expect(body.items).toHaveLength(1);
  });

  it('refuse une limite hors bornes', async () => {
    const session = await registerUser();

    const response = await app.inject({ method: 'GET', url: `${BASE}?limit=999`, headers: authHeaders(session) });

    expect(response.statusCode).toBe(400);
    expect(errorBody(response).code).toBe('VALIDATION_ERROR');
  });

  it('ne montre jamais les candidatures d_un autre compte', async () => {
    const session = await registerUser();
    const other = await registerUser();
    await createApplication(other, manualPayload({ jobTitle: `${TITLE_PREFIX}Autrui` }));

    const response = await app.inject({ method: 'GET', url: BASE, headers: authHeaders(session) });

    expect((JSON.parse(response.body) as ApplicationListResponseDto).total).toBe(0);
  });
});

describe('GET /applications/stats', () => {
  it('compte par statut et calcule le taux d_entretien', async () => {
    const session = await registerUser();
    await createApplication(session, manualPayload({ status: 'TO_APPLY' }));
    await createApplication(session, manualPayload({ status: 'APPLIED' }));
    await createApplication(session, manualPayload({ status: 'APPLIED' }));
    await createApplication(session, manualPayload({ status: 'INTERVIEW' }));
    await createApplication(session, manualPayload({ status: 'REJECTED' }));

    const response = await app.inject({ method: 'GET', url: `${BASE}/stats`, headers: authHeaders(session) });

    expect(response.statusCode).toBe(200);
    const body = JSON.parse(response.body) as ApplicationStatsDto;
    expect(body.total).toBe(5);
    expect(body.byStatus).toEqual({ TO_APPLY: 1, APPLIED: 2, INTERVIEW: 1, OFFER: 0, REJECTED: 1 });
    expect(body.appliedThisWeek).toBe(4);
    expect(body.interviewRate).toBe(0.25);
  });

  it('renvoie des compteurs vides et un taux nul pour un compte neuf', async () => {
    const session = await registerUser();

    const response = await app.inject({ method: 'GET', url: `${BASE}/stats`, headers: authHeaders(session) });

    const body = JSON.parse(response.body) as ApplicationStatsDto;
    expect(body.total).toBe(0);
    expect(body.interviewRate).toBeNull();
  });
});

describe('GET /applications/board et PATCH /applications/:id/move', () => {
  it('renvoie les cinq colonnes, meme vides', async () => {
    const session = await registerUser();

    const response = await app.inject({ method: 'GET', url: `${BASE}/board`, headers: authHeaders(session) });

    expect(response.statusCode).toBe(200);
    const body = JSON.parse(response.body) as ApplicationBoardDto;
    expect(Object.keys(body.columns)).toEqual(['TO_APPLY', 'APPLIED', 'INTERVIEW', 'OFFER', 'REJECTED']);
  });

  it('reindexe les deux colonnes 0..n-1 apres un deplacement', async () => {
    const session = await registerUser();
    const first = await createApplication(session, manualPayload({ jobTitle: `${TITLE_PREFIX}A` }));
    const second = await createApplication(session, manualPayload({ jobTitle: `${TITLE_PREFIX}B` }));
    const third = await createApplication(session, manualPayload({ jobTitle: `${TITLE_PREFIX}C` }));
    await createApplication(session, manualPayload({ jobTitle: `${TITLE_PREFIX}D`, status: 'INTERVIEW' }));

    const response = await move(session, second.id, 'INTERVIEW', 0);

    expect(response.statusCode).toBe(200);
    const board = await boardOf(session);
    expect(positionsOf(board, 'TO_APPLY')).toEqual([0, 1]);
    expect(board.columns.TO_APPLY.map((card) => card.id)).toEqual([first.id, third.id]);
    expect(positionsOf(board, 'INTERVIEW')).toEqual([0, 1]);
    expect(board.columns.INTERVIEW[0]?.id).toBe(second.id);
  });

  it('reordonne une colonne sans changer de statut', async () => {
    const session = await registerUser();
    const first = await createApplication(session, manualPayload({ jobTitle: `${TITLE_PREFIX}A` }));
    const second = await createApplication(session, manualPayload({ jobTitle: `${TITLE_PREFIX}B` }));
    const third = await createApplication(session, manualPayload({ jobTitle: `${TITLE_PREFIX}C` }));

    await move(session, third.id, 'TO_APPLY', 0);

    const board = await boardOf(session);
    expect(board.columns.TO_APPLY.map((card) => card.id)).toEqual([third.id, first.id, second.id]);
    expect(positionsOf(board, 'TO_APPLY')).toEqual([0, 1, 2]);
  });

  it('date la candidature et journalise le statut lors d_un deplacement hors « a postuler »', async () => {
    const session = await registerUser();
    const created = await createApplication(session, manualPayload());

    const response = await move(session, created.id, 'OFFER', 0);

    const body = JSON.parse(response.body) as ApplicationDetailDto;
    expect(body.status).toBe('OFFER');
    expect(body.appliedAt).toBe(todayInParis());
    expect(body.events.map((event) => event.type)).toEqual(['STATUS_CHANGED', 'CREATED']);
  });

  it('refuse une position negative', async () => {
    const session = await registerUser();
    const created = await createApplication(session, manualPayload());

    const response = await move(session, created.id, 'OFFER', -1);

    expect(response.statusCode).toBe(400);
    expect(errorBody(response).code).toBe('VALIDATION_ERROR');
  });
});

describe('GET, PATCH et DELETE /applications/:id', () => {
  it('renvoie la fiche de detail avec son historique', async () => {
    const session = await registerUser();
    const created = await createApplication(session, manualPayload());

    const response = await app.inject({
      method: 'GET',
      url: `${BASE}/${created.id}`,
      headers: authHeaders(session),
    });

    expect(response.statusCode).toBe(200);
    const body = JSON.parse(response.body) as ApplicationDetailDto;
    expect(body.id).toBe(created.id);
    expect(body.events).toHaveLength(1);
  });

  it('renvoie 404 sur un identifiant inconnu', async () => {
    const session = await registerUser();

    const response = await app.inject({
      method: 'GET',
      url: `${BASE}/candidature-inexistante`,
      headers: authHeaders(session),
    });

    expect(response.statusCode).toBe(404);
    expect(errorBody(response).code).toBe('APPLICATION_NOT_FOUND');
    expect(errorBody(response).message).toBe('Candidature introuvable.');
  });

  it('change le statut, date la candidature et ajoute un evenement', async () => {
    const session = await registerUser();
    const created = await createApplication(session, manualPayload());

    const response = await app.inject({
      method: 'PATCH',
      url: `${BASE}/${created.id}`,
      headers: authHeaders(session),
      payload: { status: 'APPLIED' },
    });

    expect(response.statusCode).toBe(200);
    const body = JSON.parse(response.body) as ApplicationDetailDto;
    expect(body.status).toBe('APPLIED');
    expect(body.appliedAt).toBe(todayInParis());
    const statusEvent = body.events.find((event) => event.type === 'STATUS_CHANGED');
    expect(statusEvent?.fromStatus).toBe('TO_APPLY');
    expect(statusEvent?.toStatus).toBe('APPLIED');
  });

  it('enregistre les notes sans en conserver le contenu dans l_historique', async () => {
    const session = await registerUser();
    const created = await createApplication(session, manualPayload());

    const response = await app.inject({
      method: 'PATCH',
      url: `${BASE}/${created.id}`,
      headers: authHeaders(session),
      payload: { notes: 'Relancer mardi.' },
    });

    const body = JSON.parse(response.body) as ApplicationDetailDto;
    expect(body.notes).toBe('Relancer mardi.');
    const noteEvent = body.events.find((event) => event.type === 'NOTE_UPDATED');
    expect(noteEvent?.note).toBeNull();
  });

  it('refuse un corps de modification vide', async () => {
    const session = await registerUser();
    const created = await createApplication(session, manualPayload());

    const response = await app.inject({
      method: 'PATCH',
      url: `${BASE}/${created.id}`,
      headers: authHeaders(session),
      payload: {},
    });

    expect(response.statusCode).toBe(400);
    expect(errorBody(response).code).toBe('VALIDATION_ERROR');
  });

  it('supprime la candidature puis renvoie 404', async () => {
    const session = await registerUser();
    const created = await createApplication(session, manualPayload());

    const removed = await app.inject({
      method: 'DELETE',
      url: `${BASE}/${created.id}`,
      headers: authHeaders(session),
    });
    expect(removed.statusCode).toBe(204);

    const again = await app.inject({
      method: 'DELETE',
      url: `${BASE}/${created.id}`,
      headers: authHeaders(session),
    });
    expect(again.statusCode).toBe(404);
    expect(await prisma.applicationEvent.count({ where: { applicationId: created.id } })).toBe(0);
  });
});

describe('Isolation entre comptes (IDOR)', () => {
  it('renvoie 404 a la lecture de la candidature d_autrui', async () => {
    const session = await registerUser();
    const other = await registerUser();
    const created = await createApplication(other, manualPayload());

    const response = await app.inject({
      method: 'GET',
      url: `${BASE}/${created.id}`,
      headers: authHeaders(session),
    });

    expect(response.statusCode).toBe(404);
    expect(errorBody(response).code).toBe('APPLICATION_NOT_FOUND');
  });

  it('renvoie 404 a la modification de la candidature d_autrui', async () => {
    const session = await registerUser();
    const other = await registerUser();
    const created = await createApplication(other, manualPayload());

    const response = await app.inject({
      method: 'PATCH',
      url: `${BASE}/${created.id}`,
      headers: authHeaders(session),
      payload: { status: 'REJECTED' },
    });

    expect(response.statusCode).toBe(404);
    expect((await getDetail(other, created.id)).status).toBe('TO_APPLY');
  });

  it('renvoie 404 au deplacement de la candidature d_autrui', async () => {
    const session = await registerUser();
    const other = await registerUser();
    const created = await createApplication(other, manualPayload());

    const response = await move(session, created.id, 'OFFER', 0);

    expect(response.statusCode).toBe(404);
    expect((await getDetail(other, created.id)).status).toBe('TO_APPLY');
  });

  it('renvoie 404 a la suppression de la candidature d_autrui', async () => {
    const session = await registerUser();
    const other = await registerUser();
    const created = await createApplication(other, manualPayload());

    const response = await app.inject({
      method: 'DELETE',
      url: `${BASE}/${created.id}`,
      headers: authHeaders(session),
    });

    expect(response.statusCode).toBe(404);
    expect((await getDetail(other, created.id)).id).toBe(created.id);
  });
});

describe('Lien avec les offres', () => {
  it('garde l_instantane intact quand l_offre disparait du catalogue', async () => {
    const session = await registerUser();
    const jobId = await createJobRow({ title: `${TITLE_PREFIX}Offre ephemere`, company: 'Nova Systèmes' });
    const created = await createApplication(session, { jobId });

    await prisma.job.delete({ where: { id: jobId } });

    const detail = await getDetail(session, created.id);
    expect(detail.jobId).toBeNull();
    expect(detail.job).toBeNull();
    expect(detail.jobTitle).toBe(`${TITLE_PREFIX}Offre ephemere`);
    expect(detail.company).toBe('Nova Systèmes');
    expect(detail.sourceUrl).toBe('https://exemple.test/postuler');
  });

  it('expose la candidature suivie sur le detail de l_offre', async () => {
    const session = await registerUser();
    const jobId = await createJobRow();

    const before = await app.inject({ method: 'GET', url: `/api/v1/jobs/${jobId}`, headers: authHeaders(session) });
    expect((JSON.parse(before.body) as JobDetailDto).application).toBeNull();

    const created = await createApplication(session, { jobId, status: 'APPLIED' });

    const after = await app.inject({ method: 'GET', url: `/api/v1/jobs/${jobId}`, headers: authHeaders(session) });
    expect((JSON.parse(after.body) as JobDetailDto).application).toEqual({ id: created.id, status: 'APPLIED' });
  });

  it('ne montre jamais la candidature d_autrui sur le detail de l_offre', async () => {
    const session = await registerUser();
    const other = await registerUser();
    const jobId = await createJobRow();
    await createApplication(other, { jobId });

    const response = await app.inject({
      method: 'GET',
      url: `/api/v1/jobs/${jobId}`,
      headers: authHeaders(session),
    });

    expect((JSON.parse(response.body) as JobDetailDto).application).toBeNull();
  });
});
