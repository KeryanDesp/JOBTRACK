import { randomUUID } from 'node:crypto';
import type { NestFastifyApplication } from '@nestjs/platform-fastify';
import { Test } from '@nestjs/testing';
import type {
  BaseResumeDto,
  CoverLetterDto,
  CoverLetterSummaryDto,
  CoverLetterTone,
  ResumeContent,
  ResumeDto,
  ResumeSummaryDto,
} from '@jobtrack/shared';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { AppModule } from '../../app.module';
import { configureApp, createAdapter } from '../../app.setup';
import { ANTHROPIC_CLIENT } from '../../common/anthropic.provider';
import { PrismaService } from '../../common/prisma.service';
import { RedisService } from '../../common/redis.service';
import { SessionService } from '../auth/session.service';
import { defaultLetterOutput, defaultTailoringOutput, FakeAnthropicClient, toAnthropicClient } from './testing/fake-anthropic';

const BASE = '/api/v1/resume';

// Préfixes réservés à cette suite (même principe que `matching.e2e.spec.ts`) : ni les offres
// semées pour le développement (`FT-…`), ni celles d'une autre suite e2e ne portent jamais
// `E2E-RESUME-`.
const EXTERNAL_ID_PREFIX = 'E2E-RESUME-';
const USER_EMAIL_PREFIX = 'e2e-resume-';
// Empreinte des offres créées par CETTE suite (revue, item 8) : distincte de
// `E2E-RESUME-TAILOR-`/`E2E-RESUME-LETTER-` (préfixes des offres des specs unitaires
// `resume-tailoring.service.spec.ts`/`cover-letter.service.spec.ts`, exécutées en parallèle dans
// un worker Vitest différent) — sans cette distinction, `clearJobs` ci-dessous (`sources: none`)
// supprimait aussi leurs offres, jamais recréées entre deux tests unitaires d'une même exécution
// (flakiness). Aucun des trois préfixes n'est le préfixe d'un autre : jamais de recouvrement.
const JOB_FINGERPRINT_PREFIX = 'E2E-RESUME-JOB-';

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
// Nettoyage (même patron que `matching.e2e.spec.ts`)
// ---------------------------------------------------------------------------

async function clearJobs(): Promise<void> {
  await prisma.jobSource.deleteMany({ where: { externalId: { startsWith: EXTERNAL_ID_PREFIX } } });
  // `fingerprint: { startsWith: JOB_FINGERPRINT_PREFIX }` (revue, item 8) : sans cette condition,
  // `sources: { none: {} }` seul supprimait aussi les offres sans source des specs unitaires du
  // module (`resume-tailoring.service.spec.ts`/`cover-letter.service.spec.ts`), qui n'en créent
  // jamais — flaky quand ce fichier et ces specs tournent dans la même exécution Vitest.
  await prisma.job.deleteMany({ where: { sources: { none: {} }, fingerprint: { startsWith: JOB_FINGERPRINT_PREFIX } } });
}

/** Supprime les comptes de cette suite : `Resume`/`ResumeVersion`/`CoverLetter`/`Profile`
 * disparaissent par cascade avec l'utilisateur. */
async function clearUsers(): Promise<void> {
  const users = await prisma.user.findMany({ where: { email: { startsWith: USER_EMAIL_PREFIX } }, select: { id: true } });
  const sessions = app.get(SessionService);
  for (const user of users) {
    await sessions.destroyAllForUser(user.id);
  }
  await prisma.user.deleteMany({ where: { email: { startsWith: USER_EMAIL_PREFIX } } });
}

/** Les seaux `resume-tailoring`/`cover-letter` (clé `ratelimit:<seau>:user:<id>`) et le budget
 * d'inscription (`ratelimit:*auth/register*`, partagé avec les autres suites e2e exécutées dans
 * le même run) — jamais un `ratelimit:*` en bloc. Les verrous Redis (`resume:tailor:*`,
 * `resume:letter:*`) portent normalement une clé par (utilisateur, offre) toujours neuve (TTL de
 * 5 min, `LOCK_TTL_MS` des deux services — aucun nettoyage nécessaire, même remarque que
 * `matching.e2e.spec.ts`) ; nettoyés ici tout de même, un test (§ « Verrou déjà détenu ») en pose
 * explicitement un pour un (utilisateur, offre) réutilisé par le test suivant si jamais laissé. */
async function clearRateLimits(): Promise<void> {
  const keys = [
    ...(await redis.client.keys('ratelimit:resume-tailoring:*')),
    ...(await redis.client.keys('ratelimit:cover-letter:*')),
    ...(await redis.client.keys('ratelimit:*auth/register*')),
    ...(await redis.client.keys('resume:tailor:*')),
    ...(await redis.client.keys('resume:letter:*')),
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
  email: string;
  cookieHeader: string;
  csrf: string;
}

async function registerUser(target: NestFastifyApplication = app): Promise<Session> {
  const email = `${USER_EMAIL_PREFIX}${process.pid}-${randomUUID()}@jobtrack.local`;
  const response = await target.inject({
    method: 'POST',
    url: '/api/v1/auth/register',
    payload: { email, password: 'motdepasse-solide-2026', firstName: 'Camille', lastName: 'Martin' },
  });
  const cookieHeader = cookiesFrom(response.headers);
  const userId = response.json<{ id: string }>().id;
  return { userId, email, cookieHeader, csrf: csrfFrom(cookieHeader) };
}

function authHeaders(session: Session, extra: Record<string, string> = {}): Record<string, string> {
  return { cookie: session.cookieHeader, 'x-csrf-token': session.csrf, ...extra };
}

interface ExperienceRow {
  id: string;
}

/** Ajoute une expérience au profil (rend le profil « complet », spec §5) et renvoie son
 * identifiant réel — utilisé pour réécrire les identifiants de la fixture d'adaptation
 * (`defaultTailoringOutput`), qui porte des identifiants factices (`E2E-EXP-1`, `E2E-EXP-2`). */
async function addExperience(
  session: Session,
  input: {
    company: string;
    role: string;
    location?: string;
    startDate: string;
    endDate?: string;
    isCurrent: boolean;
    description?: string;
  },
  target: NestFastifyApplication = app,
): Promise<ExperienceRow> {
  const response = await target.inject({
    method: 'POST',
    url: '/api/v1/profile/experiences',
    headers: authHeaders(session, {}),
    payload: input,
  });
  if (response.statusCode !== 201) {
    throw new Error(`Échec de l'ajout d'expérience (${response.statusCode}) : ${response.body}`);
  }
  return response.json<ExperienceRow>();
}

async function updateProfile(
  session: Session,
  input: { firstName: string; lastName: string; phone?: string; city?: string },
  target: NestFastifyApplication = app,
): Promise<void> {
  const response = await target.inject({
    method: 'PATCH',
    url: '/api/v1/profile',
    headers: authHeaders(session),
    payload: input,
  });
  if (response.statusCode !== 200) {
    throw new Error(`Échec de la mise à jour du profil (${response.statusCode}) : ${response.body}`);
  }
}

/** Deux expériences dont les identifiants correspondent à ceux attendus par
 * `fixtures/resume/tailoring-FT-0001.json` (`E2E-EXP-1`, `E2E-EXP-2`, après réécriture) : la
 * première porte deux puces sources (« dirige une équipe » / « assure la livraison »), la seconde
 * n'en porte qu'une seule (spec §5 : « une expérience sans highlights garde ceux de la base »). */
async function createCompleteProfile(session: Session, target: NestFastifyApplication = app): Promise<[ExperienceRow, ExperienceRow]> {
  const first = await addExperience(
    session,
    {
      company: 'Solaris Ingénierie',
      role: 'Développeuse backend',
      location: 'Metz',
      startDate: '2020-01-01',
      isCurrent: true,
      description: 'Dirige une équipe de développement chez Solaris Ingénierie.\nAssure la livraison des projets clients dans les délais.',
    },
    target,
  );
  const second = await addExperience(
    session,
    {
      company: 'Ancienne Entreprise',
      role: 'Développeuse',
      startDate: '2016-01-01',
      endDate: '2019-12-31',
      isCurrent: false,
      description: 'Développe des fonctionnalités pour une plateforme interne.',
    },
    target,
  );
  return [first, second];
}

interface TailoringFixture {
  title: string;
  summary: string;
  experiences: Array<{ id: string; keep: boolean; order: number; highlights: string[] }>;
  educations: unknown[];
  skills: unknown[];
  certifications: unknown[];
  projects: unknown[];
  notes: string;
}

/** Réécrit les identifiants factices de la fixture d'adaptation (`E2E-EXP-1`, `E2E-EXP-2`) avec
 * ceux des deux expériences réellement créées — la troisième ligne de la fixture
 * (`E2E-EXP-INCONNU`) reste inchangée : elle exerce déjà « un identifiant inconnu est ignoré ». */
function tailoringOutputFor(experiences: [ExperienceRow, ExperienceRow]): TailoringFixture {
  const output = defaultTailoringOutput() as TailoringFixture;
  const [first, second] = experiences;
  const firstRow = output.experiences.find((row) => row.id === 'E2E-EXP-1');
  const secondRow = output.experiences.find((row) => row.id === 'E2E-EXP-2');
  if (firstRow) firstRow.id = first.id;
  if (secondRow) secondRow.id = second.id;
  return output;
}

interface JobFixture {
  id: string;
}

async function createJob(options: { title?: string; company?: string; description?: string } = {}): Promise<JobFixture> {
  const key = `${EXTERNAL_ID_PREFIX}${randomUUID()}`;
  const publishedAt = new Date();
  const job = await prisma.job.create({
    data: {
      fingerprint: `${JOB_FINGERPRINT_PREFIX}${randomUUID()}`,
      title: options.title ?? 'Ingénieur logiciel senior',
      company: options.company ?? 'Solaris Ingénierie',
      description: options.description ?? "Poste d'ingénieur logiciel senior chez Solaris Ingénierie, à Metz.",
      publishedAt,
      sources: {
        create: { source: 'FRANCE_TRAVAIL', externalId: key, url: `https://example.test/${key}`, publishedAt },
      },
    },
  });
  return { id: job.id };
}

/** Forme d'un corps d'erreur (`HttpExceptionFilter`) — jamais garantie par le type déclaré de
 * `tailor`/`createLetter` (`ResumeDto`/`CoverLetterDto`, le cas de succès), qui reste néanmoins le
 * seul type utile dans l'immense majorité des tests. `errorCode` (revue, item 17) centralise le
 * seul cast nécessaire pour lire `code` sur une réponse d'erreur, plutôt que de le répéter à
 * chaque site d'appel. */
interface ApiErrorBody {
  code: string;
  message?: string;
  details?: Record<string, string>;
}

function errorCode(response: { body: unknown }): string {
  return (response.body as ApiErrorBody).code;
}

async function tailor(
  session: Session,
  jobId: string,
  target: NestFastifyApplication = app,
): Promise<{ statusCode: number; body: ResumeDto }> {
  const response = await target.inject({
    method: 'POST',
    url: `${BASE}/tailor`,
    headers: authHeaders(session),
    payload: { jobId, template: 'CLASSIC' },
  });
  return { statusCode: response.statusCode, body: response.json<ResumeDto>() };
}

async function createLetter(
  session: Session,
  input: { jobId: string; tone: CoverLetterTone; resumeId?: string },
  target: NestFastifyApplication = app,
): Promise<{ statusCode: number; body: CoverLetterDto }> {
  const response = await target.inject({
    method: 'POST',
    url: `${BASE}/letters`,
    headers: authHeaders(session),
    payload: input,
  });
  return { statusCode: response.statusCode, body: response.json<CoverLetterDto>() };
}

let ftJobCountBefore = 0;

beforeAll(async () => {
  fake = new FakeAnthropicClient();
  app = await buildApp(fake);
  unconfiguredApp = await buildApp(null);

  prisma = app.get(PrismaService);
  redis = app.get(RedisService);

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

describe('GET /resume/base', () => {
  it('renvoie un contenu vide mais valide, le modele CLASSIC par defaut, profil incomplet', async () => {
    const session = await registerUser();

    const response = await app.inject({ method: 'GET', url: `${BASE}/base`, headers: authHeaders(session) });

    expect(response.statusCode).toBe(200);
    const body = response.json<BaseResumeDto>();
    expect(body.template).toBe('CLASSIC');
    expect(body.profileComplete).toBe(false);
    expect(body.content.experiences).toEqual([]);
  });

  it('profil complet des qu_une experience existe, coordonnees incluses', async () => {
    const session = await registerUser();
    await addExperience(session, { company: 'Acme', role: 'Développeuse', startDate: '2024-01-01', isCurrent: true });

    const response = await app.inject({ method: 'GET', url: `${BASE}/base`, headers: authHeaders(session) });

    const body = response.json<BaseResumeDto>();
    expect(body.profileComplete).toBe(true);
    expect(body.content.identity.email).toBe(session.email);
    expect(body.content.experiences).toHaveLength(1);
  });
});

describe('PATCH /resume/template', () => {
  it('change le modele prefere, memorise pour GET /resume/base', async () => {
    const session = await registerUser();

    const response = await app.inject({
      method: 'PATCH',
      url: `${BASE}/template`,
      headers: authHeaders(session),
      payload: { template: 'MODERN' },
    });

    expect(response.statusCode).toBe(200);
    expect(response.json<BaseResumeDto>().template).toBe('MODERN');

    const after = await app.inject({ method: 'GET', url: `${BASE}/base`, headers: authHeaders(session) });
    expect(after.json<BaseResumeDto>().template).toBe('MODERN');
  });
});

describe('POST /resume/tailor', () => {
  it('cree une version 1 IA avec changements, rejette la puce inventant 30 pourcents', async () => {
    const session = await registerUser();
    const experiences = await createCompleteProfile(session);
    fake.setTailoringOutput(tailoringOutputFor(experiences));
    const job = await createJob();

    const response = await tailor(session, job.id);

    expect(response.statusCode).toBe(201);
    const body = response.body;
    expect(body.title).toBe('CV Ingénieur logiciel senior — Solaris Ingénierie');
    expect(body.version.number).toBe(1);
    expect(body.version.source).toBe('AI');
    expect(body.changes).not.toBeNull();
    const firstExperienceChanges = body.changes?.experiences.find((experience) => experience.id === experiences[0].id);
    expect(firstExperienceChanges?.rejected.length).toBeGreaterThan(0);
    expect(firstExperienceChanges?.rejected[0]?.reason).toContain('30');

    const row = await prisma.resume.findUniqueOrThrow({ where: { id: body.id } });
    expect(row.currentVersion).toBe(1);
    const version = await prisma.resumeVersion.findUniqueOrThrow({ where: { resumeId_version: { resumeId: body.id, version: 1 } } });
    expect(version.source).toBe('AI');
  });

  it('404 JOB_NOT_FOUND pour une offre inexistante', async () => {
    const session = await registerUser();
    await createCompleteProfile(session);

    const response = await app.inject({
      method: 'POST',
      url: `${BASE}/tailor`,
      headers: authHeaders(session),
      payload: { jobId: 'offre-inexistante', template: 'CLASSIC' },
    });

    expect(response.statusCode).toBe(404);
    expect(response.json<{ code: string }>().code).toBe('JOB_NOT_FOUND');
  });
});

describe('GET /resume — liste des CV adaptes', () => {
  it('liste le CV adapte avec le titre et l_entreprise de l_offre', async () => {
    const session = await registerUser();
    const experiences = await createCompleteProfile(session);
    fake.setTailoringOutput(tailoringOutputFor(experiences));
    const job = await createJob({ title: 'Poste de liste', company: 'Entreprise de liste' });
    const created = await tailor(session, job.id);

    const response = await app.inject({ method: 'GET', url: BASE, headers: authHeaders(session) });

    expect(response.statusCode).toBe(200);
    const items = response.json<ResumeSummaryDto[]>();
    const item = items.find((entry) => entry.id === created.body.id);
    expect(item?.jobTitle).toBe('Poste de liste');
    expect(item?.company).toBe('Entreprise de liste');
  });
});

describe('GET /resume/:id, PATCH /resume/:id, DELETE /resume/:id', () => {
  it('GET renvoie le contenu et les changements de la version courante', async () => {
    const session = await registerUser();
    const experiences = await createCompleteProfile(session);
    fake.setTailoringOutput(tailoringOutputFor(experiences));
    const job = await createJob();
    const created = await tailor(session, job.id);

    const response = await app.inject({ method: 'GET', url: `${BASE}/${created.body.id}`, headers: authHeaders(session) });

    expect(response.statusCode).toBe(200);
    const body = response.json<ResumeDto>();
    expect(body.version.number).toBe(1);
    expect(body.changes).toEqual(created.body.changes);
  });

  it('PATCH cree une version 2 USER, conserve les changements de la version IA', async () => {
    const session = await registerUser();
    const experiences = await createCompleteProfile(session);
    fake.setTailoringOutput(tailoringOutputFor(experiences));
    const job = await createJob();
    const created = await tailor(session, job.id);

    const patchResponse = await app.inject({
      method: 'PATCH',
      url: `${BASE}/${created.body.id}`,
      headers: authHeaders(session),
      payload: { content: { ...created.body.content, summary: 'Résumé modifié par l_utilisatrice.' } },
    });

    expect(patchResponse.statusCode).toBe(200);
    const patched = patchResponse.json<ResumeDto>();
    expect(patched.version.number).toBe(2);
    expect(patched.version.source).toBe('USER');
    expect(patched.currentVersion).toBe(2);
    expect(patched.content.summary).toBe('Résumé modifié par l_utilisatrice.');
    expect(patched.changes).toEqual(created.body.changes);
  });

  it('PATCH avec un identifiant d_experience etranger renvoie 400 VALIDATION_ERROR', async () => {
    const session = await registerUser();
    const experiences = await createCompleteProfile(session);
    fake.setTailoringOutput(tailoringOutputFor(experiences));
    const job = await createJob();
    const created = await tailor(session, job.id);

    const [baseExperience] = created.body.content.experiences;
    if (!baseExperience) throw new Error('Le CV adapte devrait porter au moins une experience.');
    const foreignContent: ResumeContent = {
      ...created.body.content,
      experiences: [{ ...baseExperience, id: 'identifiant-etranger' }],
    };

    const response = await app.inject({
      method: 'PATCH',
      url: `${BASE}/${created.body.id}`,
      headers: authHeaders(session),
      payload: { content: foreignContent },
    });

    expect(response.statusCode).toBe(400);
    const body = response.json<{ code: string; details: Record<string, string> }>();
    expect(body.code).toBe('VALIDATION_ERROR');
    expect(body.details['content.experiences[0].id']).toBeDefined();
  });

  it('PATCH nettoie les caracteres de controle', async () => {
    const session = await registerUser();
    const experiences = await createCompleteProfile(session);
    fake.setTailoringOutput(tailoringOutputFor(experiences));
    const job = await createJob();
    const created = await tailor(session, job.id);
    // Caractere de controle construit a l'execution (jamais insere tel quel dans ce fichier
    // source) : `stripControlChars` (`common/text/control-chars.ts`) le retire entierement.
    const controlChar = String.fromCharCode(0);

    const response = await app.inject({
      method: 'PATCH',
      url: `${BASE}/${created.body.id}`,
      headers: authHeaders(session),
      payload: { content: { ...created.body.content, summary: `Resume${controlChar}avec un caractere de controle.` } },
    });

    expect(response.statusCode).toBe(200);
    const body = response.json<ResumeDto>();
    expect(body.content.summary).not.toContain(controlChar);
    expect(body.content.summary).toBe('Resumeavec un caractere de controle.');
  });

  it("PATCH avec un prenom compose uniquement de caracteres de controle renvoie 400 VALIDATION_ERROR, jamais 500 (revue securite)", async () => {
    // `firstName` (`resumeContentSchema.identity`, `.min(1)`) passe la garde d'entree
    // (`ZodValidationPipe`, qui ne nettoie jamais) puisqu'il n'est pas vide a ce moment-la, puis
    // se retrouve reduit a une chaine vide par `sanitizeResumeContent` — sans `parseSanitizedOrThrow`
    // (`resume.service.ts`), un `.parse` nu laisserait alors une `ZodError` brute remonter en 500.
    const session = await registerUser();
    const experiences = await createCompleteProfile(session);
    fake.setTailoringOutput(tailoringOutputFor(experiences));
    const job = await createJob();
    const created = await tailor(session, job.id);
    const controlChar = String.fromCharCode(0);

    const response = await app.inject({
      method: 'PATCH',
      url: `${BASE}/${created.body.id}`,
      headers: authHeaders(session),
      payload: { content: { ...created.body.content, identity: { ...created.body.content.identity, firstName: controlChar } } },
    });

    expect(response.statusCode).toBe(400);
    const body = response.json<{ code: string }>();
    expect(body.code).toBe('VALIDATION_ERROR');
  });

  it('deux PATCH concurrents reussissent tous les deux (versions 2 et 3), jamais un 500 (revue securite, tache 5)', async () => {
    const session = await registerUser();
    const experiences = await createCompleteProfile(session);
    fake.setTailoringOutput(tailoringOutputFor(experiences));
    const job = await createJob();
    const created = await tailor(session, job.id);

    const [first, second] = await Promise.all([
      app.inject({
        method: 'PATCH',
        url: `${BASE}/${created.body.id}`,
        headers: authHeaders(session),
        payload: { content: { ...created.body.content, summary: 'Résumé modifié — premier PATCH concurrent.' } },
      }),
      app.inject({
        method: 'PATCH',
        url: `${BASE}/${created.body.id}`,
        headers: authHeaders(session),
        payload: { content: { ...created.body.content, summary: 'Résumé modifié — second PATCH concurrent.' } },
      }),
    ]);

    for (const response of [first, second]) {
      expect([200, 409]).toContain(response.statusCode);
      expect(response.statusCode).not.toBe(500);
    }
    const successVersions = [first, second]
      .filter((response) => response.statusCode === 200)
      .map((response) => response.json<ResumeDto>().version.number)
      .sort();
    // Les deux PATCH partent de la version 1 : chacun doit obtenir un numéro de version distinct
    // (2 et 3), jamais le même (la garantie que la revue sécurité vérifie ici) — sauf si l'un des
    // deux a échoué en 409 (« ceinture et bretelles », en pratique jamais atteint).
    if (successVersions.length === 2) expect(successVersions).toEqual([2, 3]);

    const finalRow = await prisma.resume.findUniqueOrThrow({ where: { id: created.body.id } });
    expect(finalRow.currentVersion).toBe(successVersions.length === 2 ? 3 : 2);
    const versionCount = await prisma.resumeVersion.count({ where: { resumeId: created.body.id } });
    expect(versionCount).toBe(1 + successVersions.length);
  });

  it('DELETE renvoie 204 puis 404 sur une seconde suppression', async () => {
    const session = await registerUser();
    const experiences = await createCompleteProfile(session);
    fake.setTailoringOutput(tailoringOutputFor(experiences));
    const job = await createJob();
    const created = await tailor(session, job.id);

    const first = await app.inject({ method: 'DELETE', url: `${BASE}/${created.body.id}`, headers: authHeaders(session) });
    expect(first.statusCode).toBe(204);

    const second = await app.inject({ method: 'DELETE', url: `${BASE}/${created.body.id}`, headers: authHeaders(session) });
    expect(second.statusCode).toBe(404);

    const versions = await prisma.resumeVersion.count({ where: { resumeId: created.body.id } });
    expect(versions).toBe(0);
  });
});

describe('Isolation entre utilisateurs', () => {
  it('un CV adapte n_est jamais visible ni modifiable par un autre utilisateur', async () => {
    const owner = await registerUser();
    const experiences = await createCompleteProfile(owner);
    fake.setTailoringOutput(tailoringOutputFor(experiences));
    const job = await createJob();
    const created = await tailor(owner, job.id);

    const stranger = await registerUser();

    const get = await app.inject({ method: 'GET', url: `${BASE}/${created.body.id}`, headers: authHeaders(stranger) });
    expect(get.statusCode).toBe(404);

    const patch = await app.inject({
      method: 'PATCH',
      url: `${BASE}/${created.body.id}`,
      headers: authHeaders(stranger),
      payload: { content: created.body.content },
    });
    expect(patch.statusCode).toBe(404);

    const del = await app.inject({ method: 'DELETE', url: `${BASE}/${created.body.id}`, headers: authHeaders(stranger) });
    expect(del.statusCode).toBe(404);

    const list = await app.inject({ method: 'GET', url: BASE, headers: authHeaders(stranger) });
    expect(list.json<ResumeSummaryDto[]>()).toEqual([]);
  });
});

describe('Suppression de l_offre liee', () => {
  it('jobId devient null, le CV adapte reste lisible', async () => {
    const session = await registerUser();
    const experiences = await createCompleteProfile(session);
    fake.setTailoringOutput(tailoringOutputFor(experiences));
    const job = await createJob();
    const created = await tailor(session, job.id);

    await prisma.job.delete({ where: { id: job.id } });

    const response = await app.inject({ method: 'GET', url: `${BASE}/${created.body.id}`, headers: authHeaders(session) });

    expect(response.statusCode).toBe(200);
    const body = response.json<ResumeDto>();
    expect(body.jobId).toBeNull();
    expect(body.jobTitle).toBeNull();
  });
});

describe('Budgets', () => {
  it('renvoie 429 des que le budget de 20 adaptations/heure est deja epuise', async () => {
    const session = await registerUser();
    await createCompleteProfile(session);
    await redis.client.set(`ratelimit:resume-tailoring:user:${session.userId}`, '20', 'EX', 3600);
    const job = await createJob();

    const response = await tailor(session, job.id);

    expect(response.statusCode).toBe(429);
    expect(errorCode(response)).toBe('RATE_LIMITED');
  });

  it('renvoie 429 des que le budget de 10 lettres/heure est deja epuise', async () => {
    const session = await registerUser();
    await createCompleteProfile(session);
    await redis.client.set(`ratelimit:cover-letter:user:${session.userId}`, '10', 'EX', 3600);
    const job = await createJob();

    const response = await createLetter(session, { jobId: job.id, tone: 'PROFESSIONAL' });

    expect(response.statusCode).toBe(429);
    expect(errorCode(response)).toBe('RATE_LIMITED');
  });

  it("404 JOB_NOT_FOUND sur l_adaptation de CV ne consomme jamais le budget (compte manuellement apres le controle offre)", async () => {
    const session = await registerUser();
    await createCompleteProfile(session);

    const response = await tailor(session, 'offre-inexistante-budget');

    expect(response.statusCode).toBe(404);
    expect(errorCode(response)).toBe('JOB_NOT_FOUND');
    const counter = await redis.client.get(`ratelimit:resume-tailoring:user:${session.userId}`);
    expect(counter).toBeNull();
  });

  it('404 JOB_NOT_FOUND sur la generation de lettre ne consomme jamais le budget', async () => {
    const session = await registerUser();
    await createCompleteProfile(session);

    const response = await createLetter(session, { jobId: 'offre-inexistante-budget', tone: 'SHORT' });

    expect(response.statusCode).toBe(404);
    expect(errorCode(response)).toBe('JOB_NOT_FOUND');
    const counter = await redis.client.get(`ratelimit:cover-letter:user:${session.userId}`);
    expect(counter).toBeNull();
  });
});

describe('Verrou deja detenu (tache 5, budget compte apres le controle du verrou)', () => {
  it('409 TAILORING_IN_PROGRESS avec un verrou Redis reel deja pose, aucun appel au modele', async () => {
    const session = await registerUser();
    await createCompleteProfile(session);
    const job = await createJob();
    // Meme format de cle que `ResumeTailoringService`/`LOCK_PREFIX` (`resume:tailor:{userId}:{jobId}`).
    await redis.client.set(`resume:tailor:${session.userId}:${job.id}`, 'un-autre-jeton', 'PX', 300_000, 'NX');

    const response = await tailor(session, job.id);

    expect(response.statusCode).toBe(409);
    expect(errorCode(response)).toBe('TAILORING_IN_PROGRESS');
    expect(fake.calls).toBe(0);
  });

  it('409 LETTER_IN_PROGRESS avec un verrou Redis reel deja pose, aucun appel au modele', async () => {
    const session = await registerUser();
    await createCompleteProfile(session);
    const job = await createJob();
    // Meme format de cle que `CoverLetterService`/`LOCK_PREFIX` (`resume:letter:{userId}:{jobId}`).
    await redis.client.set(`resume:letter:${session.userId}:${job.id}`, 'un-autre-jeton', 'PX', 300_000, 'NX');

    const response = await createLetter(session, { jobId: job.id, tone: 'SHORT' });

    expect(response.statusCode).toBe(409);
    expect(errorCode(response)).toBe('LETTER_IN_PROGRESS');
    expect(fake.calls).toBe(0);
  });
});

describe('Service IA non configure', () => {
  it('503 AI_NOT_CONFIGURED sur l_adaptation de CV', async () => {
    const session = await registerUser(unconfiguredApp);
    await createCompleteProfile(session, unconfiguredApp);
    const job = await createJob();

    const response = await tailor(session, job.id, unconfiguredApp);

    expect(response.statusCode).toBe(503);
    expect(errorCode(response)).toBe('AI_NOT_CONFIGURED');
  });

  it('503 AI_NOT_CONFIGURED sur la generation de lettre', async () => {
    const session = await registerUser(unconfiguredApp);
    await createCompleteProfile(session, unconfiguredApp);
    const job = await createJob();

    const response = await createLetter(session, { jobId: job.id, tone: 'SHORT' }, unconfiguredApp);

    expect(response.statusCode).toBe(503);
    expect(errorCode(response)).toBe('AI_NOT_CONFIGURED');
  });
});

describe('Profil incomplet', () => {
  it('409 PROFILE_INCOMPLETE sur l_adaptation de CV sans experience ni competence', async () => {
    const session = await registerUser();
    const job = await createJob();

    const response = await tailor(session, job.id);

    expect(response.statusCode).toBe(409);
    expect(errorCode(response)).toBe('PROFILE_INCOMPLETE');
    const row = await prisma.resume.findFirst({ where: { userId: session.userId } });
    expect(row).toBeNull();
  });
});

describe('Sortie IA inexploitable', () => {
  it('502 AI_OUTPUT_INVALID sans ecrire de CV, jamais de texte de profil dans l_erreur', async () => {
    const session = await registerUser();
    await createCompleteProfile(session);
    const secretMarker = `SECRET-${randomUUID()}`;
    const job = await createJob({ description: `Description confidentielle ${secretMarker}.` });
    fake.setTailoringOutput('sortie-non-conforme-au-schema');

    const response = await tailor(session, job.id);

    expect(response.statusCode).toBe(502);
    expect(errorCode(response)).toBe('AI_OUTPUT_INVALID');
    expect(JSON.stringify(response.body)).not.toContain(secretMarker);
    const row = await prisma.resume.findFirst({ where: { userId: session.userId } });
    expect(row).toBeNull();
  });
});

describe('Lettres de motivation', () => {
  const tones: CoverLetterTone[] = ['SHORT', 'PROFESSIONAL', 'PERSONAL'];

  for (const tone of tones) {
    it(`genere une lettre de ton ${tone.toLowerCase()} avec la signature complete`, async () => {
      const session = await registerUser();
      await updateProfile(session, { firstName: 'Camille', lastName: 'Martin' });
      await createCompleteProfile(session);
      const job = await createJob();

      const response = await createLetter(session, { jobId: job.id, tone });

      expect(response.statusCode).toBe(201);
      const body = response.body;
      expect(body.tone).toBe(tone);
      expect(body.content.signature).toBe('Camille Martin');
      expect(body.content.paragraphs.length).toBeGreaterThan(0);

      const row = await prisma.coverLetter.findUniqueOrThrow({ where: { id: body.id } });
      expect(row.tone).toBe(tone);
    });
  }

  it('liste, lit, modifie et supprime une lettre', async () => {
    const session = await registerUser();
    await createCompleteProfile(session);
    const job = await createJob();
    const created = await createLetter(session, { jobId: job.id, tone: 'SHORT' });

    const list = await app.inject({ method: 'GET', url: `${BASE}/letters`, headers: authHeaders(session) });
    expect(list.statusCode).toBe(200);
    expect(list.json<CoverLetterSummaryDto[]>().some((entry) => entry.id === created.body.id)).toBe(true);

    const get = await app.inject({ method: 'GET', url: `${BASE}/letters/${created.body.id}`, headers: authHeaders(session) });
    expect(get.statusCode).toBe(200);

    const update = await app.inject({
      method: 'PATCH',
      url: `${BASE}/letters/${created.body.id}`,
      headers: authHeaders(session),
      payload: { content: { ...created.body.content, closing: 'Cordialement.' } },
    });
    expect(update.statusCode).toBe(200);
    expect(update.json<CoverLetterDto>().content.closing).toBe('Cordialement.');

    const remove = await app.inject({ method: 'DELETE', url: `${BASE}/letters/${created.body.id}`, headers: authHeaders(session) });
    expect(remove.statusCode).toBe(204);

    const afterDelete = await app.inject({ method: 'GET', url: `${BASE}/letters/${created.body.id}`, headers: authHeaders(session) });
    expect(afterDelete.statusCode).toBe(404);
  });

  it('associe une lettre a un CV adapte du meme utilisateur, refuse celui d_un autre', async () => {
    const owner = await registerUser();
    const experiences = await createCompleteProfile(owner);
    fake.setTailoringOutput(tailoringOutputFor(experiences));
    const job = await createJob();
    const resume = await tailor(owner, job.id);

    const withOwnResume = await createLetter(owner, { jobId: job.id, tone: 'SHORT', resumeId: resume.body.id });
    expect(withOwnResume.statusCode).toBe(201);
    expect(withOwnResume.body.resumeId).toBe(resume.body.id);

    const stranger = await registerUser();
    await createCompleteProfile(stranger);
    const strangerJob = await createJob();
    const withForeignResume = await createLetter(stranger, { jobId: strangerJob.id, tone: 'SHORT', resumeId: resume.body.id });
    expect(withForeignResume.statusCode).toBe(404);
  });

  it('isolation : une lettre n_est jamais visible ni modifiable par un autre utilisateur', async () => {
    const owner = await registerUser();
    await createCompleteProfile(owner);
    const job = await createJob();
    const created = await createLetter(owner, { jobId: job.id, tone: 'SHORT' });

    const stranger = await registerUser();
    const get = await app.inject({ method: 'GET', url: `${BASE}/letters/${created.body.id}`, headers: authHeaders(stranger) });
    expect(get.statusCode).toBe(404);

    const list = await app.inject({ method: 'GET', url: `${BASE}/letters`, headers: authHeaders(stranger) });
    expect(list.json<CoverLetterSummaryDto[]>()).toEqual([]);
  });

  it('GET /resume/letters n_est jamais avale par GET /resume/:id', async () => {
    const session = await registerUser();

    const response = await app.inject({ method: 'GET', url: `${BASE}/letters`, headers: authHeaders(session) });

    expect(response.statusCode).toBe(200);
    expect(response.json<CoverLetterSummaryDto[]>()).toEqual([]);
  });

  it("un identifiant de lettre envoye a /resume/:id (jamais /resume/letters/:id) renvoie 404 RESUME_NOT_FOUND, la lettre reste intacte", async () => {
    const session = await registerUser();
    await createCompleteProfile(session);
    const job = await createJob();
    const created = await createLetter(session, { jobId: job.id, tone: 'SHORT' });

    const get = await app.inject({ method: 'GET', url: `${BASE}/${created.body.id}`, headers: authHeaders(session) });
    expect(get.statusCode).toBe(404);
    expect(get.json<{ code: string }>().code).toBe('RESUME_NOT_FOUND');

    // Payload conforme à `updateResumeSchema` (`ZodValidationPipe` valide la forme avant même
    // que le contrôleur ne s'exécute, quel que soit l'id dans l'URL) — jamais le contenu de la
    // lettre elle-même (une autre forme, `CoverLetterContent`), qui serait rejeté en 400 par le
    // pipe avant d'atteindre le 404 attendu ici.
    const unrelatedResumeContent: ResumeContent = {
      schemaVersion: 1,
      identity: { firstName: 'Prénom', lastName: 'Nom', title: null },
      summary: '',
      experiences: [],
      educations: [],
      skills: [],
      languages: [],
      certifications: [],
      projects: [],
    };
    const patch = await app.inject({
      method: 'PATCH',
      url: `${BASE}/${created.body.id}`,
      headers: authHeaders(session),
      payload: { content: unrelatedResumeContent },
    });
    expect(patch.statusCode).toBe(404);
    expect(patch.json<{ code: string }>().code).toBe('RESUME_NOT_FOUND');

    const del = await app.inject({ method: 'DELETE', url: `${BASE}/${created.body.id}`, headers: authHeaders(session) });
    expect(del.statusCode).toBe(404);
    expect(del.json<{ code: string }>().code).toBe('RESUME_NOT_FOUND');

    // La lettre elle-même n'a jamais été touchée par ces trois appels égarés sur les routes `/resume/:id`.
    const stillThere = await app.inject({ method: 'GET', url: `${BASE}/letters/${created.body.id}`, headers: authHeaders(session) });
    expect(stillThere.statusCode).toBe(200);
    expect(stillThere.json<CoverLetterDto>().content.closing).toBe(created.body.content.closing);
  });

  it("PATCH avec un sujet compose uniquement de caracteres de controle renvoie 400 VALIDATION_ERROR, jamais 500 (revue securite)", async () => {
    const session = await registerUser();
    await createCompleteProfile(session);
    const job = await createJob();
    const created = await createLetter(session, { jobId: job.id, tone: 'SHORT' });
    const controlChar = String.fromCharCode(0);

    const response = await app.inject({
      method: 'PATCH',
      url: `${BASE}/letters/${created.body.id}`,
      headers: authHeaders(session),
      payload: { content: { ...created.body.content, subject: controlChar } },
    });

    expect(response.statusCode).toBe(400);
    expect(response.json<{ code: string }>().code).toBe('VALIDATION_ERROR');
  });

  it("sortie IA avec un sujet non vide mais entierement compose de caracteres de controle : 502 AI_OUTPUT_INVALID, jamais 500 (revue securite)", async () => {
    // Un sujet de deux caracteres de controle est non vide et passe donc le premier controle de
    // schema cote service (avant nettoyage) ; c_est seulement une fois nettoye par
    // `stripControlChars` (`groundLetter`) que `subject` devient une chaine vide — doit toujours
    // remonter en 502, jamais en 500.
    const session = await registerUser();
    await createCompleteProfile(session);
    const job = await createJob();
    fake.setLetterOutput({
      recipient: null,
      subject: String.fromCharCode(0).repeat(2),
      greeting: 'Madame, Monsieur,',
      paragraphs: ["Je vous propose d'échanger sur ma candidature."],
      closing: 'Cordialement,',
      signature: 'Prénom Nom',
    });

    const response = await createLetter(session, { jobId: job.id, tone: 'SHORT' });

    expect(response.statusCode).toBe(502);
    expect(errorCode(response)).toBe('AI_OUTPUT_INVALID');

    // `fake.reset()` (`clearAll`, entre deux tests) ne remet jamais `letterOutput` à sa valeur
    // par défaut (par conception — voir sa docstring) : rétabli explicitement ici, sinon tout
    // test suivant de ce fichier qui génère une lettre sans poser sa propre sortie recevrait
    // celle-ci, restée invalide.
    fake.setLetterOutput(defaultLetterOutput());
  });
});

describe('Securite du prompt envoye au modele', () => {
  it('le prompt d_adaptation de CV ne contient jamais l_email ni le telephone du compte', async () => {
    const session = await registerUser();
    await updateProfile(session, { firstName: 'Camille', lastName: 'Martin', phone: '0601020304' });
    const experiences = await createCompleteProfile(session);
    fake.setTailoringOutput(tailoringOutputFor(experiences));
    const job = await createJob();

    const response = await tailor(session, job.id);

    expect(response.statusCode).toBe(201);
    const sent = JSON.stringify(fake.lastRequest);
    expect(sent).not.toContain(session.email);
    expect(sent).not.toContain('0601020304');
  });

  it('le prompt de lettre ne contient jamais l_email ni le telephone du compte', async () => {
    const session = await registerUser();
    await updateProfile(session, { firstName: 'Camille', lastName: 'Martin', phone: '0601020304' });
    await createCompleteProfile(session);
    const job = await createJob();

    const response = await createLetter(session, { jobId: job.id, tone: 'SHORT' });

    expect(response.statusCode).toBe(201);
    const sent = JSON.stringify(fake.lastRequest);
    expect(sent).not.toContain(session.email);
    expect(sent).not.toContain('0601020304');
  });
});

describe('Hygiene de la base de developpement', () => {
  it('les offres semees FT- survivent intactes a toute la suite', async () => {
    const ftJobCountAfter = await prisma.job.count({ where: { sources: { some: { externalId: { startsWith: 'FT-' } } } } });
    expect(ftJobCountAfter).toBe(ftJobCountBefore);
  });
});
