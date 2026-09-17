import { randomUUID } from 'node:crypto';
import Anthropic from '@anthropic-ai/sdk';
import type { NestFastifyApplication } from '@nestjs/platform-fastify';
import { Test } from '@nestjs/testing';
import type { MatchBand, MatchPriority } from '@prisma/client';
import type {
  AnalyzeJobsResponseDto,
  JobListResponseDto,
  JobSummaryDto,
  MatchScoreDto,
} from '@jobtrack/shared';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { AppModule } from '../../app.module';
import { configureApp, createAdapter } from '../../app.setup';
import { ANTHROPIC_CLIENT } from '../../common/anthropic.provider';
import { PrismaService } from '../../common/prisma.service';
import { RedisService } from '../../common/redis.service';
import { SessionService } from '../auth/session.service';
import { ProfileInputsService } from './profile-inputs.service';
import { FakeAnthropicClient, toAnthropicClient } from './testing/fake-anthropic';

const BASE = '/api/v1/jobs';

// Préfixe réservé à cette suite (revue sécurité, même principe que `jobs.e2e.spec.ts`) : ni les
// offres semées pour le développement (`FT-…`), ni celles d'une autre suite e2e (`E2E-…` du
// module `jobs`) ne portent jamais `E2E-MATCH-`.
const EXTERNAL_ID_PREFIX = 'E2E-MATCH-';
const USER_EMAIL_PREFIX = 'e2e-match-';

let app: NestFastifyApplication;
let unconfiguredApp: NestFastifyApplication;
let prisma: PrismaService;
let redis: RedisService;
let fake: FakeAnthropicClient;

async function buildApp(client: FakeAnthropicClient | null): Promise<NestFastifyApplication> {
  const moduleRef = await Test.createTestingModule({ imports: [AppModule] })
    .overrideProvider(ANTHROPIC_CLIENT)
    .useValue(client ? toAnthropicClient(client) : null)
    .compile();
  const built = moduleRef.createNestApplication<NestFastifyApplication>(createAdapter());
  await configureApp(built);
  await built.init();
  await built.getHttpAdapter().getInstance().ready();
  return built;
}

// ---------------------------------------------------------------------------
// Nettoyage (même patron que `jobs.e2e.spec.ts`/`cv-import.e2e.spec.ts`)
// ---------------------------------------------------------------------------

/** Supprime les sources `E2E-MATCH-…` puis les offres devenues orphelines : `JobAnalysis` et
 * `MatchScore` de ces offres disparaissent par cascade (`onDelete: Cascade`), jamais les offres
 * `FT-…` semées pour le développement. */
async function clearJobs(): Promise<void> {
  await prisma.jobSource.deleteMany({ where: { externalId: { startsWith: EXTERNAL_ID_PREFIX } } });
  await prisma.job.deleteMany({ where: { sources: { none: {} } } });
}

/** Supprime les comptes de cette suite : `Profile` (et donc `MatchScore`, skills, expériences…)
 * disparaît par cascade avec l'utilisateur. */
async function clearUsers(): Promise<void> {
  const users = await prisma.user.findMany({ where: { email: { startsWith: USER_EMAIL_PREFIX } }, select: { id: true } });
  const sessions = app.get(SessionService);
  for (const user of users) {
    await sessions.destroyAllForUser(user.id);
  }
  await prisma.user.deleteMany({ where: { email: { startsWith: USER_EMAIL_PREFIX } } });
}

/**
 * Le compteur manuel de `POST /jobs/analyses` et la garde de `retry` partagent le seau
 * `job-analysis` (clé `ratelimit:job-analysis:user:<id>`) : jamais un `ratelimit:*` en bloc, qui
 * toucherait aussi les compteurs d'un développeur en train de tester à côté. Les verrous Redis
 * d'analyse (`matching:analysis:<jobId>`) ne sont volontairement pas nettoyés ici : ils portent
 * un TTL court (5 min), sont toujours libérés par `finally` en fin d'analyse, et chaque test
 * utilise un `jobId` (`cuid`) neuf — aucune collision possible avec un test suivant.
 *
 * `ratelimit:*auth/register*` : cette suite inscrit plus d'une vingtaine d'utilisateurs
 * (limite de la route : 20/h par IP, `auth.controller.ts`), le compteur étant partagé avec
 * toute autre suite e2e exécutée avant elle dans le même run — sans ce nettoyage, une suite
 * suivante peut se voir refuser l'inscription en cascade (même précaution documentée par
 * `jobs.e2e.spec.ts`).
 */
async function clearRateLimits(): Promise<void> {
  const keys = [
    ...(await redis.client.keys('ratelimit:job-analysis:*')),
    ...(await redis.client.keys('ratelimit:*auth/register*')),
  ];
  if (keys.length > 0) await redis.client.del(...keys);
}

async function clearAll(): Promise<void> {
  await clearUsers();
  await clearJobs();
  await clearRateLimits();
  fake.reset();
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
  const email = `${USER_EMAIL_PREFIX}${process.pid}-${randomUUID()}@jobtrack.local`;
  const response = await target.inject({
    method: 'POST',
    url: '/api/v1/auth/register',
    payload: { email, password: 'motdepasse-solide-2026', firstName: 'E2E', lastName: 'Match' },
  });
  const cookieHeader = cookiesFrom(response.headers);
  const userId = response.json<{ id: string }>().id;
  return { userId, cookieHeader, csrf: csrfFrom(cookieHeader) };
}

function authHeaders(session: Session, extra: Record<string, string> = {}): Record<string, string> {
  return { cookie: session.cookieHeader, 'x-csrf-token': session.csrf, ...extra };
}

/** Ajoute une compétence technique au profil de l'utilisateur (rend le profil « complet »,
 * spec §5 : au moins une compétence ou une expérience). */
async function addSkill(session: Session, name: string, target: NestFastifyApplication = app): Promise<void> {
  const response = await target.inject({
    method: 'POST',
    url: '/api/v1/profile/skills',
    headers: authHeaders(session),
    payload: { name, category: 'TECHNICAL', level: 'ADVANCED' },
  });
  if (response.statusCode !== 201) {
    throw new Error(`Échec de l'ajout de compétence (${response.statusCode}) : ${response.body}`);
  }
}

async function profileIdOf(session: Session, target: NestFastifyApplication = app): Promise<string> {
  const prismaOf = target.get(PrismaService);
  const profile = await prismaOf.profile.findUniqueOrThrow({ where: { userId: session.userId } });
  return profile.id;
}

/** `profileId` + empreinte courante (tâche 6 — amendement tâche 5 : `JobsService` ne lit plus
 * qu'une ligne `MatchScore` dont l'empreinte correspond à celle-ci) : les tests de tri/onglet
 * ci-dessous posent directement une ligne `MatchScore` (hors moteur de score, déjà testé par
 * `scoring/*.spec.ts`) et doivent donc lui donner l'empreinte réellement attendue par
 * `GET /jobs`, pas une valeur arbitraire — sans quoi la ligne serait traitée comme périmée. */
async function matchContextOf(session: Session, target: NestFastifyApplication = app): Promise<{ profileId: string; fingerprint: string }> {
  const profileId = await profileIdOf(session, target);
  const fingerprint = await target.get(ProfileInputsService).currentProfileFingerprint(session.userId);
  if (fingerprint === null) throw new Error('Empreinte de profil introuvable — le profil devrait exister.');
  return { profileId, fingerprint };
}

// ---------------------------------------------------------------------------
// Fixtures d'offres
// ---------------------------------------------------------------------------

interface JobFixtureOptions {
  title?: string;
  description?: string;
  technologies?: { name: string; required: boolean }[];
  remoteMode?: 'remote' | 'onsite' | 'hybrid' | null;
  publishedAt?: Date;
}

/**
 * Crée une offre directement en base (comme `jobs.e2e.spec.ts` le fait pour ses scénarios les
 * plus contrôlés) et enregistre les exigences que le client Anthropic factice doit renvoyer pour
 * elle : `experienceRequired: false` (« Débutant accepté », facteur Expérience toujours à 100) et
 * `remoteMode: 'remote'` par défaut (facteur Localisation toujours à 100, spec §5) — deux facteurs
 * qui ne dépendent donc jamais du profil de l'utilisateur, seul le facteur Compétences (poids 35)
 * varie encore avec les technologies demandées ci-dessus. Poids évalué garanti ≥ 65 % (jamais
 * « données insuffisantes »).
 */
async function createAnalyzableJob(options: JobFixtureOptions = {}): Promise<{ id: string; key: string }> {
  const key = `KEY${randomUUID().replace(/-/g, '')}`;
  const publishedAt = options.publishedAt ?? new Date();
  const job = await prisma.job.create({
    data: {
      fingerprint: `${EXTERNAL_ID_PREFIX}fp-${key}`,
      title: `${options.title ?? 'Poste de test'} ${key}`,
      company: `${EXTERNAL_ID_PREFIX}Entreprise`,
      description: options.description ?? 'Description neutre pour le moteur de correspondance.',
      publishedAt,
      experienceRequired: false,
      sources: {
        create: {
          source: 'FRANCE_TRAVAIL',
          externalId: `${EXTERNAL_ID_PREFIX}${key}`,
          url: `https://example.test/${key}`,
          publishedAt,
        },
      },
    },
  });
  fake.setRequirements(key, {
    technologies: (options.technologies ?? []).map((tech) => ({ name: tech.name, required: tech.required, category: 'language' })),
    softSkills: [],
    experienceYearsMin: null,
    seniority: null,
    educationLevel: null,
    educationFields: [],
    languages: [],
    remoteMode: options.remoteMode === undefined ? 'remote' : options.remoteMode,
    contractHints: [],
    mustHaves: [],
    niceToHaves: [],
    summary: 'Offre de test pour le moteur de correspondance.',
  });
  return { id: job.id, key };
}

/** Offre sans analyse ni exigence associée : suffisante pour les tests de tri/onglet de
 * `GET /jobs`, qui lisent `MatchScore` déjà posé directement (jamais le moteur de score). */
async function createPlainJob(options: { title?: string; publishedAt?: Date } = {}): Promise<string> {
  const key = `KEY${randomUUID().replace(/-/g, '')}`;
  const publishedAt = options.publishedAt ?? new Date();
  const job = await prisma.job.create({
    data: {
      fingerprint: `${EXTERNAL_ID_PREFIX}fp-${key}`,
      title: `${options.title ?? 'Offre de liste'} ${key}`,
      company: `${EXTERNAL_ID_PREFIX}Entreprise`,
      description: 'Description neutre.',
      publishedAt,
      sources: {
        create: { source: 'FRANCE_TRAVAIL', externalId: `${EXTERNAL_ID_PREFIX}${key}`, url: `https://example.test/${key}`, publishedAt },
      },
    },
  });
  return job.id;
}

/** Pose directement une ligne `MatchScore` (contourne le moteur de score, hors périmètre de
 * cette suite — déjà testé par `scoring/*.spec.ts`) : seules les routes/tris/onglets de la
 * tâche 6 sont exercés ici. L'empreinte doit être celle réellement attendue par `GET /jobs`
 * (`matchContextOf`) — une valeur arbitraire ferait passer la ligne pour périmée. */
async function createMatchScore(
  context: { profileId: string; fingerprint: string },
  jobId: string,
  values: { score: number | null; relevance: number | null; band: MatchBand | null; priority: MatchPriority | null },
): Promise<void> {
  await prisma.matchScore.create({
    data: {
      profileId: context.profileId,
      jobId,
      score: values.score,
      relevance: values.relevance,
      band: values.band,
      priority: values.priority,
      factors: { factors: [], explanation: { top: [], weak: [] }, insufficientData: values.score === null },
      profileFingerprint: context.fingerprint,
      analysisVersion: 1,
      computedAt: new Date(),
    },
  });
}

async function analyze(
  session: Session,
  jobIds: string[],
  target: NestFastifyApplication = app,
): Promise<{ statusCode: number; body: AnalyzeJobsResponseDto }> {
  const response = await target.inject({
    method: 'POST',
    url: `${BASE}/analyses`,
    headers: authHeaders(session),
    payload: { jobIds },
  });
  return { statusCode: response.statusCode, body: response.json<AnalyzeJobsResponseDto>() };
}

async function getMatch(
  session: Session,
  jobId: string,
  target: NestFastifyApplication = app,
): Promise<{ statusCode: number; body: unknown }> {
  const response = await target.inject({ method: 'GET', url: `${BASE}/${jobId}/match`, headers: authHeaders(session) });
  return { statusCode: response.statusCode, body: response.json() };
}

async function listJobs(session: Session, query = ''): Promise<{ statusCode: number; body: JobListResponseDto }> {
  const response = await app.inject({
    method: 'GET',
    url: query ? `${BASE}?${query}` : BASE,
    headers: authHeaders(session),
  });
  return { statusCode: response.statusCode, body: response.json<JobListResponseDto>() };
}

function findItem(items: JobSummaryDto[], jobId: string): JobSummaryDto | undefined {
  return items.find((item) => item.id === jobId);
}

let ftJobCountBefore = 0;

beforeAll(async () => {
  fake = new FakeAnthropicClient();
  app = await buildApp(fake);
  unconfiguredApp = await buildApp(null);

  prisma = app.get(PrismaService);
  redis = app.get(RedisService);

  // Hygiène de la base de développement (tâche 6) : les offres semées (`FT-…`) doivent
  // survivre intactes à toute la suite.
  ftJobCountBefore = await prisma.job.count({ where: { sources: { some: { externalId: { startsWith: 'FT-' } } } } });
});

beforeEach(async () => {
  await clearAll();
});

afterAll(async () => {
  await clearAll();
  await app.close();
  await unconfiguredApp.close();
});

describe('POST /jobs/analyses', () => {
  it('analyse une offre manquante, calcule un score et persiste JobAnalysis en DONE', async () => {
    const session = await registerUser();
    await addSkill(session, 'TypeScript');
    const { id: jobId } = await createAnalyzableJob({ technologies: [{ name: 'TypeScript', required: true }] });

    const response = await analyze(session, [jobId]);

    expect(response.statusCode).toBe(200);
    expect(response.body.analyzed).toBe(1);
    expect(response.body.failed).toBe(0);
    expect(response.body.notConfigured).toBe(false);
    expect(response.body.profileComplete).toBe(true);
    expect(response.body.scores[jobId]?.score).not.toBeNull();
    expect(fake.calls).toBe(1);

    const row = await prisma.jobAnalysis.findUniqueOrThrow({ where: { jobId } });
    expect(row.status).toBe('DONE');
  });

  it('un second appel ne rappelle jamais le modele (analyse partagee, mise en cache)', async () => {
    const session = await registerUser();
    await addSkill(session, 'TypeScript');
    const { id: jobId } = await createAnalyzableJob({ technologies: [{ name: 'TypeScript', required: true }] });

    const first = await analyze(session, [jobId]);
    const callsAfterFirst = fake.calls;
    expect(first.body.analyzed).toBe(1);

    const second = await analyze(session, [jobId]);

    expect(second.statusCode).toBe(200);
    expect(second.body.analyzed).toBe(0); // deja DONE : aucune analyse relancee.
    expect(fake.calls).toBe(callsAfterFirst); // le modele factice n'est jamais rappele.
    expect(second.body.scores[jobId]).toEqual(first.body.scores[jobId]);
  });

  it('renvoie 429 des que le budget de 60 analyses/heure est deja epuise', async () => {
    const session = await registerUser();
    await redis.client.set(`ratelimit:job-analysis:user:${session.userId}`, '60', 'EX', 3600);
    const { id: jobId } = await createAnalyzableJob();

    const response = await analyze(session, [jobId]);

    expect(response.statusCode).toBe(429);
    expect(response.body).toMatchObject({ code: 'RATE_LIMITED' });
    expect(fake.calls).toBe(0);
    const row = await prisma.jobAnalysis.findUnique({ where: { jobId } });
    expect(row).toBeNull();
  });

  it('service IA non configure : 200 avec les scores existants quand aucune analyse n_est necessaire', async () => {
    const analyzedBy = await registerUser();
    await addSkill(analyzedBy, 'TypeScript');
    const { id: jobId } = await createAnalyzableJob({ technologies: [{ name: 'TypeScript', required: true }] });
    await analyze(analyzedBy, [jobId]); // analyse deja DONE, partagee entre utilisateurs.

    const session = await registerUser(unconfiguredApp);
    await addSkill(session, 'TypeScript', unconfiguredApp);

    const response = await analyze(session, [jobId], unconfiguredApp);

    expect(response.statusCode).toBe(200);
    expect(response.body.notConfigured).toBe(true);
    expect(response.body.scores[jobId]?.score).not.toBeNull();
  });

  it('service IA non configure : 503 AI_NOT_CONFIGURED quand une analyse est necessaire', async () => {
    const session = await registerUser(unconfiguredApp);
    const jobId = await createPlainJob();

    const response = await unconfiguredApp.inject({
      method: 'POST',
      url: `${BASE}/analyses`,
      headers: authHeaders(session),
      payload: { jobIds: [jobId] },
    });

    expect(response.statusCode).toBe(503);
    expect(response.json<{ code: string }>().code).toBe('AI_NOT_CONFIGURED');
    const row = await prisma.jobAnalysis.findUnique({ where: { jobId } });
    expect(row).toBeNull();
  });

  it('un incident transitoire du modele devient 503, sans jamais exposer le texte de l_offre', async () => {
    const session = await registerUser();
    const secretMarker = `SECRET-${randomUUID()}`;
    const { id: jobId } = await createAnalyzableJob({ description: `Texte confidentiel ${secretMarker}.` });
    fake.failNext(new Anthropic.APIConnectionError({ message: 'panne reseau' }));

    const response = await app.inject({
      method: 'POST',
      url: `${BASE}/analyses`,
      headers: authHeaders(session),
      payload: { jobIds: [jobId] },
    });

    expect(response.statusCode).toBe(503);
    expect(response.json<{ code: string }>().code).toBe('AI_UNAVAILABLE');
    expect(response.body).not.toContain(secretMarker);
  });
});

describe('GET /jobs/:id/match', () => {
  it('renvoie les facteurs et le statut d_une offre analysee', async () => {
    const session = await registerUser();
    await addSkill(session, 'TypeScript');
    const { id: jobId } = await createAnalyzableJob({ technologies: [{ name: 'TypeScript', required: true }] });
    await analyze(session, [jobId]);

    const response = await getMatch(session, jobId);

    expect(response.statusCode).toBe(200);
    const body = response.body as MatchScoreDto;
    expect(body.analysis.status).toBe('done');
    expect(Array.isArray(body.factors)).toBe(true);
    expect(body.factors.length).toBeGreaterThan(0);
    expect(body.profileComplete).toBe(true);
  });

  it('404 JOB_NOT_FOUND pour une offre inexistante', async () => {
    const session = await registerUser();

    const response = await getMatch(session, 'offre-inexistante');

    expect(response.statusCode).toBe(404);
    expect((response.body as { code: string }).code).toBe('JOB_NOT_FOUND');
  });

  it('profil incomplet : score null, aucune ligne MatchScore ecrite', async () => {
    const analyzedBy = await registerUser();
    await addSkill(analyzedBy, 'TypeScript');
    const { id: jobId } = await createAnalyzableJob({ technologies: [{ name: 'TypeScript', required: true }] });
    await analyze(analyzedBy, [jobId]);

    const incomplete = await registerUser(); // jamais de competence/experience ajoutee.
    const response = await getMatch(incomplete, jobId);

    expect(response.statusCode).toBe(200);
    const body = response.body as MatchScoreDto;
    expect(body.profileComplete).toBe(false);
    expect(body.score).toBeNull();
    expect(body.insufficientData).toBe(true);

    const profile = await prisma.profile.findUniqueOrThrow({ where: { userId: incomplete.userId } });
    const rows = await prisma.matchScore.count({ where: { profileId: profile.id } });
    expect(rows).toBe(0);
  });
});

describe('POST /jobs/:id/analyses/retry', () => {
  it('relance avec succes une analyse en echec (202)', async () => {
    const session = await registerUser();
    const { id: jobId } = await createAnalyzableJob();
    fake.failNext(new Anthropic.AnthropicError('sortie non conforme'));
    const failed = await analyze(session, [jobId]);
    expect(failed.body.failed).toBe(1);

    const response = await app.inject({
      method: 'POST',
      url: `${BASE}/${jobId}/analyses/retry`,
      headers: authHeaders(session),
    });

    expect(response.statusCode).toBe(202);
    expect(response.json<{ status: string }>().status).toBe('done');
    const row = await prisma.jobAnalysis.findUniqueOrThrow({ where: { jobId } });
    expect(row.status).toBe('DONE');
  });

  it('409 ANALYSIS_NOT_RETRYABLE sur une offre deja DONE', async () => {
    const session = await registerUser();
    const { id: jobId } = await createAnalyzableJob();
    await analyze(session, [jobId]);

    const response = await app.inject({
      method: 'POST',
      url: `${BASE}/${jobId}/analyses/retry`,
      headers: authHeaders(session),
    });

    expect(response.statusCode).toBe(409);
    expect(response.json<{ code: string }>().code).toBe('ANALYSIS_NOT_RETRYABLE');
  });

  it('le retry partage le meme budget que POST /jobs/analyses (429 une fois epuise)', async () => {
    const session = await registerUser();
    const { id: jobId } = await createAnalyzableJob();
    fake.failNext(new Anthropic.AnthropicError('sortie non conforme'));
    await analyze(session, [jobId]);
    await redis.client.set(`ratelimit:job-analysis:user:${session.userId}`, '60', 'EX', 3600);

    const response = await app.inject({
      method: 'POST',
      url: `${BASE}/${jobId}/analyses/retry`,
      headers: authHeaders(session),
    });

    expect(response.statusCode).toBe(429);
    expect(response.json<{ code: string }>().code).toBe('RATE_LIMITED');
  });
});

describe('GET /jobs — tris et onglets de correspondance', () => {
  it('tri=match classe par score decroissant, offres non evaluees en dernier', async () => {
    const session = await registerUser();
    const context = await matchContextOf(session);
    const jobHigh = await createPlainJob({ title: 'Score eleve' });
    const jobLow = await createPlainJob({ title: 'Score bas' });
    const jobUnscored = await createPlainJob({ title: 'Non evaluee' });
    await createMatchScore(context, jobHigh, { score: 90, relevance: 90, band: 'EXCELLENT', priority: 'VERY_HIGH' });
    await createMatchScore(context, jobLow, { score: 40, relevance: 40, band: 'WEAK', priority: 'LOW' });

    const response = await listJobs(session, 'tri=match');

    expect(response.statusCode).toBe(200);
    const ids = response.body.items.map((item) => item.id);
    expect(ids.indexOf(jobHigh)).toBeLessThan(ids.indexOf(jobLow));
    expect(ids.indexOf(jobLow)).toBeLessThan(ids.indexOf(jobUnscored));
    expect(findItem(response.body.items, jobHigh)?.match?.score).toBe(90);
    expect(findItem(response.body.items, jobUnscored)?.match).toBeNull();
  });

  it('tri=pertinence favorise la fraicheur : une offre recente peut devancer une offre ancienne mieux notee', async () => {
    const session = await registerUser();
    const context = await matchContextOf(session);
    const fresh = await createPlainJob({ title: 'Offre fraiche', publishedAt: new Date() });
    const old = await createPlainJob({ title: 'Offre ancienne', publishedAt: new Date(Date.now() - 45 * 24 * 60 * 60 * 1000) });
    // Score brut : `old` (100) > `fresh` (84) ; pertinence (score x fraicheur) : `fresh` (84 x 1)
    // > `old` (100 x 0,6 = 60) — la fraicheur inverse l'ordre (spec §5, §7).
    await createMatchScore(context, fresh, { score: 84, relevance: 84, band: 'GOOD', priority: 'HIGH' });
    await createMatchScore(context, old, { score: 100, relevance: 60, band: 'EXCELLENT', priority: 'VERY_HIGH' });

    const byRelevance = await listJobs(session, 'tri=pertinence');
    const byMatch = await listJobs(session, 'tri=match');

    const relevanceIds = byRelevance.body.items.map((item) => item.id);
    const matchIds = byMatch.body.items.map((item) => item.id);
    expect(relevanceIds.indexOf(fresh)).toBeLessThan(relevanceIds.indexOf(old));
    expect(matchIds.indexOf(old)).toBeLessThan(matchIds.indexOf(fresh));
  });

  it('onglet=pour-vous ne garde que les offres dont le score du profil atteint 60', async () => {
    const session = await registerUser();
    const context = await matchContextOf(session);
    const eligible = await createPlainJob({ title: 'Eligible pour vous' });
    const ineligible = await createPlainJob({ title: 'Pas pour vous' });
    await createMatchScore(context, eligible, { score: 75, relevance: 75, band: 'GOOD', priority: 'HIGH' });
    await createMatchScore(context, ineligible, { score: 40, relevance: 40, band: 'WEAK', priority: 'LOW' });

    const response = await listJobs(session, 'onglet=pour-vous');

    const ids = response.body.items.map((item) => item.id);
    expect(ids).toContain(eligible);
    expect(ids).not.toContain(ineligible);
  });

  it('onglet=priorite ne garde que VERY_HIGH/HIGH', async () => {
    const session = await registerUser();
    const context = await matchContextOf(session);
    const highPriority = await createPlainJob({ title: 'Forte priorite' });
    const lowPriority = await createPlainJob({ title: 'Faible priorite' });
    await createMatchScore(context, highPriority, { score: 80, relevance: 80, band: 'GOOD', priority: 'HIGH' });
    await createMatchScore(context, lowPriority, { score: 30, relevance: 30, band: 'WEAK', priority: 'LOW' });

    const response = await listJobs(session, 'onglet=priorite');

    const ids = response.body.items.map((item) => item.id);
    expect(ids).toContain(highPriority);
    expect(ids).not.toContain(lowPriority);
  });

  it('isolation : le score calcule pour un utilisateur n_apparait jamais chez un autre', async () => {
    const owner = await registerUser();
    const ownerContext = await matchContextOf(owner);
    const stranger = await registerUser();
    const jobId = await createPlainJob({ title: 'Offre partagee' });
    await createMatchScore(ownerContext, jobId, { score: 92, relevance: 92, band: 'EXCELLENT', priority: 'VERY_HIGH' });

    const asOwner = await listJobs(owner);
    const asStranger = await listJobs(stranger);

    expect(findItem(asOwner.body.items, jobId)?.match?.score).toBe(92);
    expect(findItem(asStranger.body.items, jobId)?.match).toBeNull();
  });
});

describe('Recalcul apres modification du profil', () => {
  it('un changement de competences change le score (empreinte de profil perimee)', async () => {
    const session = await registerUser();
    await addSkill(session, 'Cobol'); // ne correspond a aucune technologie exigee.
    const { id: jobId } = await createAnalyzableJob({ technologies: [{ name: 'TypeScript', required: true }] });
    await analyze(session, [jobId]);

    const before = (await getMatch(session, jobId)).body as MatchScoreDto;

    await addSkill(session, 'TypeScript'); // change l'empreinte du profil.
    const after = (await getMatch(session, jobId)).body as MatchScoreDto;

    expect(after.score).not.toBeNull();
    expect(before.score).not.toBeNull();
    expect(after.score).not.toBe(before.score);
  });

  it('GET /jobs?tri=match affiche match:null des qu_une competence change, jusqu_a la reanalyse', async () => {
    const session = await registerUser();
    await addSkill(session, 'TypeScript');
    const { id: jobId } = await createAnalyzableJob({ technologies: [{ name: 'TypeScript', required: true }] });
    await analyze(session, [jobId]);

    const beforeChange = await listJobs(session, 'tri=match');
    expect(findItem(beforeChange.body.items, jobId)?.match).not.toBeNull();

    await addSkill(session, 'Rust'); // empreinte de profil perimee pour la ligne MatchScore existante.

    const afterChange = await listJobs(session, 'tri=match');
    expect(findItem(afterChange.body.items, jobId)?.match).toBeNull();

    await analyze(session, [jobId]); // POST /jobs/analyses recalcule a la nouvelle empreinte.

    const afterRecompute = await listJobs(session, 'tri=match');
    expect(findItem(afterRecompute.body.items, jobId)?.match).not.toBeNull();
  });
});

describe('Hygiene de la base de developpement', () => {
  it('les offres semees FT- survivent intactes a toute la suite', async () => {
    const ftJobCountAfter = await prisma.job.count({ where: { sources: { some: { externalId: { startsWith: 'FT-' } } } } });
    expect(ftJobCountAfter).toBe(ftJobCountBefore);
  });
});
