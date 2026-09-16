import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { mkdtemp, readdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import Anthropic from '@anthropic-ai/sdk';
import type { NestFastifyApplication } from '@nestjs/platform-fastify';
import { Test } from '@nestjs/testing';
import type { CvApplyResult, CvImportDto, CvImportSummaryDto } from '@jobtrack/shared';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { AppModule } from '../../app.module';
import { configureApp, createAdapter } from '../../app.setup';
import { ANTHROPIC_CLIENT, type AnthropicClient } from '../../common/anthropic.provider';
import { PrismaService } from '../../common/prisma.service';
import { RedisService } from '../../common/redis.service';
import { DiskFileStorage } from '../../common/storage/disk-file-storage';
import { FILE_STORAGE } from '../../common/storage/file-storage';
import { SessionService } from '../auth/session.service';
import { buildDocx } from './zip-test-fixtures';

// `process.cwd()` vaut `apps/api` sous `vitest run` (invoqué depuis ce paquet, comme
// `nest --watch` — cf. `resolveStorageRoot`) : pas de dépendance à `import.meta.url`,
// que la configuration `tsc` de ce paquet (module CommonJS) n'autorise pas.
const FIXTURES_DIR = join(process.cwd(), 'fixtures');
const PDF_FIXTURE = readFileSync(join(FIXTURES_DIR, 'cv-demo.pdf'));
const DOCX_FIXTURE = readFileSync(join(FIXTURES_DIR, 'cv-demo.docx'));
const TXT_FIXTURE = readFileSync(join(FIXTURES_DIR, 'not-a-cv.txt'));

const BASE = '/api/v1/cv-imports';

const EMPTY_APPLY_BODY = {
  identity: {},
  experiences: [],
  educations: [],
  skills: [],
  languages: [],
  certifications: [],
  projects: [],
  preferences: {},
};

// Personnage fictif « Camille Démo » (même contenu que les fixtures) : 2 expériences,
// 1 formation, 4 compétences, 2 langues — cf. `apps/api/scripts/make-cv-fixtures.py`.
const FIXTURE_WIRE = {
  identity: {
    firstName: 'Camille',
    lastName: 'Démo',
    phone: null,
    city: 'Metz',
    country: 'France',
    title: 'Développeuse full-stack',
    summary: null,
  },
  experiences: [
    {
      company: 'Acme Corp',
      role: 'Développeuse full-stack',
      location: 'Metz',
      startDate: '2022-01-01',
      endDate: null,
      isCurrent: true,
      description: null,
    },
    {
      company: 'Beta SARL',
      role: 'Développeuse junior',
      location: 'Metz',
      startDate: '2019-01-01',
      endDate: '2022-01-01',
      isCurrent: false,
      description: null,
    },
  ],
  educations: [
    {
      school: 'Université de Lorraine',
      degree: 'Master informatique',
      field: null,
      startDate: '2017-01-01',
      endDate: '2019-01-01',
      description: null,
    },
  ],
  skills: [
    { name: 'TypeScript', category: 'TECHNICAL', level: 'ADVANCED' },
    { name: 'React', category: 'TECHNICAL', level: 'ADVANCED' },
    { name: 'Node.js', category: 'TECHNICAL', level: 'ADVANCED' },
    { name: 'PostgreSQL', category: 'TECHNICAL', level: 'INTERMEDIATE' },
  ],
  languages: [
    { name: 'Français', level: 'NATIVE' },
    { name: 'Anglais', level: 'B2' },
  ],
  certifications: [],
  projects: [],
  preferences: { desiredRoles: ['Développeuse full-stack'], locations: ['Metz'] },
};

interface FakeParsedMessage {
  model: string;
  stop_reason: Anthropic.StopReason;
  parsed_output: unknown;
  usage: { input_tokens: number; output_tokens: number };
}

type CountTokens = (params: Anthropic.MessageCountTokensParams) => Promise<Anthropic.MessageTokensCount>;
type Parse = (params: Anthropic.MessageCreateParamsNonStreaming) => Promise<FakeParsedMessage>;

const fakeMessages = {
  countTokens: vi.fn<CountTokens>(),
  parse: vi.fn<Parse>(),
};

// Seul cast du fichier (même motif que `cv-extraction.service.spec.ts`) : le service ne lit
// que `messages.countTokens`/`messages.parse`, jamais le reste de la surface `Anthropic`.
const fakeAnthropic: AnthropicClient = { messages: fakeMessages } as unknown as Anthropic;

function defaultParse(): Promise<FakeParsedMessage> {
  return Promise.resolve({
    model: 'fake',
    stop_reason: 'end_turn',
    parsed_output: FIXTURE_WIRE,
    usage: { input_tokens: 1_000, output_tokens: 300 },
  });
}

// ---------------------------------------------------------------------------
// Multipart : corps construits à la main (boundary + Buffer), `app.inject` n'a pas
// d'aide native pour ça côté Fastify léger utilisé en test.
// ---------------------------------------------------------------------------

const BOUNDARY = 'jobtrack-e2e-boundary';

function filePart(fileName: string, mimeType: string, buffer: Buffer, fieldName = 'file'): Buffer {
  return Buffer.concat([
    Buffer.from(
      `--${BOUNDARY}\r\nContent-Disposition: form-data; name="${fieldName}"; filename="${fileName}"\r\nContent-Type: ${mimeType}\r\n\r\n`,
    ),
    buffer,
    Buffer.from('\r\n'),
  ]);
}

function fieldPart(name: string, value: string): Buffer {
  return Buffer.from(`--${BOUNDARY}\r\nContent-Disposition: form-data; name="${name}"\r\n\r\n${value}\r\n`);
}

function multipartBody(parts: Buffer[]): Buffer {
  return Buffer.concat([...parts, Buffer.from(`--${BOUNDARY}--\r\n`)]);
}

const MULTIPART_CONTENT_TYPE = `multipart/form-data; boundary=${BOUNDARY}`;

// ---------------------------------------------------------------------------
// Bootstrap : deux applications Nest — l'une avec un faux client Anthropic
// (« ai: true »), l'autre sans client (« ai: false », comme en l'absence de clé).
// Stockage sur un dossier temporaire dédié par application, jamais `./storage`.
// ---------------------------------------------------------------------------

let app: NestFastifyApplication;
let prisma: PrismaService;
let redis: RedisService;
let storageDir: string;

let unconfiguredApp: NestFastifyApplication;
let unconfiguredStorageDir: string;

async function buildApp(client: AnthropicClient, tmpPrefix: string): Promise<{ app: NestFastifyApplication; dir: string }> {
  const dir = await mkdtemp(join(tmpdir(), tmpPrefix));
  const moduleRef = await Test.createTestingModule({ imports: [AppModule] })
    .overrideProvider(ANTHROPIC_CLIENT)
    .useValue(client)
    .overrideProvider(FILE_STORAGE)
    .useValue(new DiskFileStorage(dir))
    .compile();
  const built = moduleRef.createNestApplication<NestFastifyApplication>(createAdapter());
  await configureApp(built);
  await built.init();
  await built.getHttpAdapter().getInstance().ready();
  return { app: built, dir };
}

async function clearRateLimits(): Promise<void> {
  const keys = await redis.client.keys('ratelimit:*');
  if (keys.length > 0) await redis.client.del(...keys);
}

async function clearUsers(): Promise<void> {
  // Uniquement les comptes de cette suite : le cascade Prisma (`onDelete: Cascade`) supprime
  // les `CvImport` avec l'utilisateur — aucun nettoyage manuel de cette table n'est nécessaire.
  const users = await prisma.user.findMany({ where: { email: { startsWith: 'e2e-cv-' } }, select: { id: true } });
  const sessions = app.get(SessionService);
  for (const user of users) {
    await sessions.destroyAllForUser(user.id);
  }
  await prisma.user.deleteMany({ where: { email: { startsWith: 'e2e-cv-' } } });
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

/** Inscrit un nouvel utilisateur de test (préfixe `e2e-cv-`, unique par appel) et renvoie sa session. */
async function registerUser(target: NestFastifyApplication = app): Promise<Session> {
  const email = `e2e-cv-${process.pid}-${randomUUID()}@jobtrack.local`;
  const response = await target.inject({
    method: 'POST',
    url: '/api/v1/auth/register',
    payload: { email, password: 'motdepasse-solide-2026', firstName: 'E2E', lastName: 'Cv' },
  });
  const cookieHeader = cookiesFrom(response.headers);
  const userId = response.json<{ id: string }>().id;
  return { userId, cookieHeader, csrf: csrfFrom(cookieHeader) };
}

function authHeaders(session: Session, extra: Record<string, string> = {}): Record<string, string> {
  return { cookie: session.cookieHeader, 'x-csrf-token': session.csrf, ...extra };
}

async function uploadFixture(
  session: Session,
  fixture: Buffer,
  fileName: string,
  mimeType: string,
  target: NestFastifyApplication = app,
) {
  return target.inject({
    method: 'POST',
    url: BASE,
    headers: authHeaders(session, { 'content-type': MULTIPART_CONTENT_TYPE }),
    payload: multipartBody([filePart(fileName, mimeType, fixture)]),
  });
}

beforeAll(async () => {
  const configured = await buildApp(fakeAnthropic, 'jobtrack-cv-e2e-');
  app = configured.app;
  storageDir = configured.dir;

  const unconfigured = await buildApp(null, 'jobtrack-cv-e2e-unconfigured-');
  unconfiguredApp = unconfigured.app;
  unconfiguredStorageDir = unconfigured.dir;

  prisma = app.get(PrismaService);
  redis = app.get(RedisService);
});

beforeEach(async () => {
  await clearUsers();
  await clearRateLimits();
  fakeMessages.countTokens.mockReset().mockResolvedValue({ input_tokens: 1_000 });
  fakeMessages.parse.mockReset().mockImplementation(defaultParse);
});

afterAll(async () => {
  await clearUsers();
  await clearRateLimits();
  await app.close();
  await unconfiguredApp.close();
  await rm(storageDir, { recursive: true, force: true });
  await rm(unconfiguredStorageDir, { recursive: true, force: true });
});

describe('Import de CV', () => {
  it('annonce les capacites : ia disponible avec un client configure', async () => {
    const session = await registerUser();

    const response = await app.inject({ method: 'GET', url: `${BASE}/capabilities`, headers: authHeaders(session) });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({
      ai: true,
      maxSizeBytes: 10 * 1024 * 1024,
      acceptedTypes: [
        'application/pdf',
        'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
      ],
    });
  });

  it('un pdf fixture produit un brouillon EXTRACTED fidele, nom de fichier assaini', async () => {
    const session = await registerUser();

    const response = await uploadFixture(session, PDF_FIXTURE, 'dossier/perso/cv-demo.pdf', 'application/pdf');

    expect(response.statusCode).toBe(201);
    const dto = response.json<CvImportDto>();
    expect(dto.status).toBe('EXTRACTED');
    expect(dto.fileName).toBe('cv-demo.pdf'); // segments de chemin retires
    expect(dto.extracted?.identity.firstName).toBe('Camille');
    expect(dto.extracted?.identity.title).toBe('Développeuse full-stack');
    expect(dto.extracted?.experiences).toHaveLength(2);
    expect(dto.extracted?.educations).toHaveLength(1);
    expect(dto.extracted?.skills).toHaveLength(4);
    expect(dto.extracted?.languages).toHaveLength(2);
    expect(dto).not.toHaveProperty('storageKey');
  });

  it('un docx fixture produit egalement un brouillon EXTRACTED', async () => {
    const session = await registerUser();

    const response = await uploadFixture(
      session,
      DOCX_FIXTURE,
      'cv-demo.docx',
      'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    );

    expect(response.statusCode).toBe(201);
    const dto = response.json<CvImportDto>();
    expect(dto.status).toBe('EXTRACTED');
    expect(dto.extracted?.experiences).toHaveLength(2);
  });

  it('refuse un fichier texte quelconque (INVALID_FILE)', async () => {
    const session = await registerUser();

    const response = await uploadFixture(session, TXT_FIXTURE, 'not-a-cv.txt', 'text/plain');

    expect(response.statusCode).toBe(400);
    expect(response.json<{ code: string }>().code).toBe('INVALID_FILE');
  });

  it('refuse un fichier depassant 10 Mo avec un message francais', async () => {
    const session = await registerUser();
    const oversized = Buffer.concat([Buffer.from('%PDF-1.4\n'), Buffer.alloc(10 * 1024 * 1024 + 1024, 0x20)]);

    const response = await uploadFixture(session, oversized, 'trop-gros.pdf', 'application/pdf');

    expect(response.statusCode).toBe(413);
    const body = response.json<{ code: string; message: string }>();
    expect(body.message).toBe('Le contenu envoyé est trop volumineux.');
  });

  it('refuse une requete sans fichier', async () => {
    const session = await registerUser();

    const response = await app.inject({
      method: 'POST',
      url: BASE,
      headers: authHeaders(session, { 'content-type': MULTIPART_CONTENT_TYPE }),
      payload: multipartBody([fieldPart('note', 'sans fichier')]),
    });

    expect(response.statusCode).toBe(400);
    expect(response.json<{ code: string }>().code).toBe('INVALID_FILE');
  });

  it('refuse un corps qui n_est pas multipart/form-data', async () => {
    const session = await registerUser();

    const response = await app.inject({
      method: 'POST',
      url: BASE,
      headers: authHeaders(session, { 'content-type': 'application/json' }),
      payload: JSON.stringify({ hello: 'world' }),
    });

    expect(response.statusCode).toBe(400);
    expect(response.json<{ code: string }>().code).toBe('INVALID_FILE');
  });

  it('refuse un champ de fichier autre que "file"', async () => {
    const session = await registerUser();

    const response = await app.inject({
      method: 'POST',
      url: BASE,
      headers: authHeaders(session, { 'content-type': MULTIPART_CONTENT_TYPE }),
      payload: multipartBody([filePart('cv-demo.pdf', 'application/pdf', PDF_FIXTURE, 'document')]),
    });

    expect(response.statusCode).toBe(400);
    expect(response.json<{ code: string }>().code).toBe('INVALID_FILE');
  });

  it('une erreur non prevue du client Anthropic devient un brouillon FAILED (jamais un 500)', async () => {
    const session = await registerUser();
    fakeMessages.parse.mockRejectedValueOnce(new TypeError('boom'));

    const response = await uploadFixture(session, PDF_FIXTURE, 'cv-demo.pdf', 'application/pdf');

    expect(response.statusCode).toBe(201);
    const dto = response.json<CvImportDto>();
    expect(dto.status).toBe('FAILED');
    expect(dto.error).toBe("L'analyse du document a échoué. Réessayez.");
  });

  it('isole la lecture : le proprietaire voit son import, un autre utilisateur recoit 404', async () => {
    const owner = await registerUser();
    const stranger = await registerUser();
    const upload = await uploadFixture(owner, PDF_FIXTURE, 'cv-demo.pdf', 'application/pdf');
    const importId = upload.json<CvImportDto>().id;

    const asOwner = await app.inject({ method: 'GET', url: `${BASE}/${importId}`, headers: authHeaders(owner) });
    expect(asOwner.statusCode).toBe(200);

    const asStranger = await app.inject({ method: 'GET', url: `${BASE}/${importId}`, headers: authHeaders(stranger) });
    expect(asStranger.statusCode).toBe(404);
    expect(asStranger.json<{ code: string }>().code).toBe('IMPORT_NOT_FOUND');
  });

  it('applique la selection au profil : identite, collections, preferences fusionnees, elements decoches absents', async () => {
    const session = await registerUser();
    const upload = await uploadFixture(session, PDF_FIXTURE, 'cv-demo.pdf', 'application/pdf');
    const dto = upload.json<CvImportDto>();
    const extracted = dto.extracted;
    if (!extracted) throw new Error('extraction absente — le test precedent aurait deja echoue');

    // Preference existante avant l'import : verifie la fusion sans doublon (pas un remplacement).
    // `jobPreferencesSchema` n'a pas de champs optionnels pour les tableaux : chacun doit être
    // fourni explicitement, même vide.
    const preferencesPatch = await app.inject({
      method: 'PATCH',
      url: '/api/v1/profile/preferences',
      headers: authHeaders(session),
      payload: {
        desiredRoles: ['Chef de projet'],
        desiredCategories: [],
        locations: [],
        remoteModes: [],
        contractTypes: [],
      },
    });
    expect(preferencesPatch.statusCode).toBe(200);

    const applyBody = {
      identity: { firstName: extracted.identity.firstName, title: extracted.identity.title },
      // Premiere experience decochee : elle ne doit jamais atteindre la base.
      experiences: extracted.experiences.map((item, index) => ({ selected: index !== 0, item })),
      educations: extracted.educations.map((item) => ({ selected: true, item })),
      skills: extracted.skills.map((item) => ({ selected: true, item })),
      languages: extracted.languages.map((item) => ({ selected: true, item })),
      certifications: [],
      projects: [],
      preferences: { desiredRoles: extracted.preferences.desiredRoles, locations: extracted.preferences.locations },
    };

    const applyResponse = await app.inject({
      method: 'POST',
      url: `${BASE}/${dto.id}/apply`,
      headers: authHeaders(session),
      payload: applyBody,
    });

    expect(applyResponse.statusCode).toBe(201);
    const result = applyResponse.json<CvApplyResult>();
    expect(result.created).toEqual({ experiences: 1, educations: 1, skills: 4, languages: 2, certifications: 0, projects: 0 });

    const profile = await app.inject({ method: 'GET', url: '/api/v1/profile', headers: authHeaders(session) });
    expect(profile.json<{ firstName: string; title: string | null }>().firstName).toBe('Camille');

    const experiences = await app.inject({
      method: 'GET',
      url: '/api/v1/profile/experiences',
      headers: authHeaders(session),
    });
    const experienceRows = experiences.json<{ company: string }[]>();
    expect(experienceRows).toHaveLength(1);
    expect(experienceRows[0]?.company).toBe('Beta SARL'); // « Acme Corp » decoche, jamais cree

    const preferences = await app.inject({
      method: 'GET',
      url: '/api/v1/profile/preferences',
      headers: authHeaders(session),
    });
    expect(preferences.json<{ desiredRoles: string[] }>().desiredRoles).toEqual([
      'Chef de projet',
      'Développeuse full-stack',
    ]);
  });

  it('refuse une seconde application du meme import (ALREADY_APPLIED)', async () => {
    const session = await registerUser();
    const upload = await uploadFixture(session, PDF_FIXTURE, 'cv-demo.pdf', 'application/pdf');
    const dto = upload.json<CvImportDto>();

    const first = await app.inject({
      method: 'POST',
      url: `${BASE}/${dto.id}/apply`,
      headers: authHeaders(session),
      payload: EMPTY_APPLY_BODY,
    });
    expect(first.statusCode).toBe(201);

    const second = await app.inject({
      method: 'POST',
      url: `${BASE}/${dto.id}/apply`,
      headers: authHeaders(session),
      payload: EMPTY_APPLY_BODY,
    });
    expect(second.statusCode).toBe(409);
    expect(second.json<{ code: string }>().code).toBe('ALREADY_APPLIED');
  });

  it('refuse l_application d_un import appartenant a un autre utilisateur (404)', async () => {
    const owner = await registerUser();
    const stranger = await registerUser();
    const upload = await uploadFixture(owner, PDF_FIXTURE, 'cv-demo.pdf', 'application/pdf');
    const dto = upload.json<CvImportDto>();

    const response = await app.inject({
      method: 'POST',
      url: `${BASE}/${dto.id}/apply`,
      headers: authHeaders(stranger),
      payload: EMPTY_APPLY_BODY,
    });

    expect(response.statusCode).toBe(404);
    expect(response.json<{ code: string }>().code).toBe('IMPORT_NOT_FOUND');
  });

  it('refuse d_appliquer un import qui n_est pas EXTRACTED (IMPORT_NOT_READY)', async () => {
    const session = await registerUser();
    fakeMessages.parse.mockRejectedValueOnce(new Anthropic.AnthropicError('sortie brute non conforme'));
    const upload = await uploadFixture(session, PDF_FIXTURE, 'cv-demo.pdf', 'application/pdf');
    const dto = upload.json<CvImportDto>();
    expect(dto.status).toBe('FAILED');

    const response = await app.inject({
      method: 'POST',
      url: `${BASE}/${dto.id}/apply`,
      headers: authHeaders(session),
      payload: EMPTY_APPLY_BODY,
    });

    expect(response.statusCode).toBe(409);
    expect(response.json<{ code: string }>().code).toBe('IMPORT_NOT_READY');
  });

  it('refuse de relancer un import qui n_est pas en echec (RETRY_NOT_ALLOWED)', async () => {
    const session = await registerUser();
    const upload = await uploadFixture(session, PDF_FIXTURE, 'cv-demo.pdf', 'application/pdf');
    const dto = upload.json<CvImportDto>();
    expect(dto.status).toBe('EXTRACTED');

    const response = await app.inject({
      method: 'POST',
      url: `${BASE}/${dto.id}/retry`,
      headers: authHeaders(session),
    });

    expect(response.statusCode).toBe(409);
    expect(response.json<{ code: string }>().code).toBe('RETRY_NOT_ALLOWED');
  });

  it('un incident Anthropic transitoire annule tout (503 AI_UNAVAILABLE, aucune ligne ni fichier)', async () => {
    const session = await registerUser();
    fakeMessages.parse.mockRejectedValueOnce(new Anthropic.APIConnectionError({ message: 'panne reseau' }));

    const response = await uploadFixture(session, PDF_FIXTURE, 'cv-demo.pdf', 'application/pdf');

    expect(response.statusCode).toBe(503);
    expect(response.json<{ code: string }>().code).toBe('AI_UNAVAILABLE');

    const rows = await prisma.cvImport.count({ where: { userId: session.userId } });
    expect(rows).toBe(0);
    const userFiles = await readdir(join(storageDir, session.userId)).catch(() => []);
    expect(userFiles).toHaveLength(0);
  });

  it('un docx sans texte exploitable devient FAILED avec le message dedie', async () => {
    const session = await registerUser();
    const emptyDocx = buildDocx([]);

    const response = await uploadFixture(
      session,
      emptyDocx,
      'vide.docx',
      'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    );

    expect(response.statusCode).toBe(201);
    const dto = response.json<CvImportDto>();
    expect(dto.status).toBe('FAILED');
    expect(dto.error).toBe('Le document ne contient pas de texte exploitable.');
  });

  it('un PENDING perime (plus de 15 minutes) ne bloque plus un nouvel upload', async () => {
    const session = await registerUser();
    const staleCreatedAt = new Date(Date.now() - 16 * 60 * 1000);
    await prisma.cvImport.create({
      data: {
        userId: session.userId,
        fileName: 'perime.pdf',
        mimeType: 'application/pdf',
        sizeBytes: 10,
        storageKey: `${session.userId}/${randomUUID()}.pdf`,
        status: 'PENDING',
        createdAt: staleCreatedAt,
      },
    });

    const response = await uploadFixture(session, PDF_FIXTURE, 'cv-demo.pdf', 'application/pdf');

    expect(response.statusCode).toBe(201);
    const stale = await prisma.cvImport.findFirstOrThrow({
      where: { userId: session.userId, fileName: 'perime.pdf' },
    });
    expect(stale.status).toBe('FAILED');
    expect(stale.error).toBe('Analyse interrompue. Réessayez.');
  });

  it('liste les imports du proprietaire, du plus recent au plus ancien, jamais ceux d_un autre', async () => {
    const owner = await registerUser();
    const stranger = await registerUser();
    await uploadFixture(owner, PDF_FIXTURE, 'premier.pdf', 'application/pdf');
    await uploadFixture(owner, PDF_FIXTURE, 'second.pdf', 'application/pdf');
    await uploadFixture(stranger, PDF_FIXTURE, 'cv-demo.pdf', 'application/pdf');

    const response = await app.inject({ method: 'GET', url: BASE, headers: authHeaders(owner) });

    expect(response.statusCode).toBe(200);
    const list = response.json<CvImportSummaryDto[]>();
    expect(list.map((row) => row.fileName)).toEqual(['second.pdf', 'premier.pdf']);
    // Version allegee : ni le brouillon complet, ni la cle de stockage.
    expect(list[0]).not.toHaveProperty('extracted');
    expect(list[0]).not.toHaveProperty('storageKey');
    expect(list[0]).toHaveProperty('appliedAt', null);
  });

  it('upload et retry partagent un seul budget (3/h) : le retry compte comme un nouvel appel', async () => {
    const session = await registerUser();
    fakeMessages.parse.mockRejectedValueOnce(new Anthropic.AnthropicError('sortie brute non conforme'));

    // 1er appel (echoue -> FAILED, compte tout de meme sur le budget).
    const failedUpload = await uploadFixture(session, PDF_FIXTURE, 'cv-0.pdf', 'application/pdf');
    expect(failedUpload.statusCode).toBe(201);
    const failedDto = failedUpload.json<CvImportDto>();
    expect(failedDto.status).toBe('FAILED');

    // 2e et 3e appels : deux autres uploads, budget desormais epuise (3/3).
    for (let index = 1; index < 3; index += 1) {
      const response = await uploadFixture(session, PDF_FIXTURE, `cv-${index}.pdf`, 'application/pdf');
      expect(response.statusCode).toBe(201);
    }

    // 4e appel : un retry, pas un upload — bloque si (et seulement si) le budget est bien partage.
    const retryResponse = await app.inject({
      method: 'POST',
      url: `${BASE}/${failedDto.id}/retry`,
      headers: authHeaders(session),
    });

    expect(retryResponse.statusCode).toBe(429);
    expect(retryResponse.json<{ code: string }>().code).toBe('RATE_LIMITED');
  });

  it('deux applications concurrentes du meme import : une seule reussit, les collections ne sont creees qu_une fois', async () => {
    const session = await registerUser();
    const upload = await uploadFixture(session, PDF_FIXTURE, 'cv-demo.pdf', 'application/pdf');
    const dto = upload.json<CvImportDto>();
    const extracted = dto.extracted;
    if (!extracted) throw new Error('extraction absente — le test precedent aurait deja echoue');

    const applyBody = {
      ...EMPTY_APPLY_BODY,
      experiences: extracted.experiences.map((item) => ({ selected: true, item })),
    };

    const [first, second] = await Promise.all([
      app.inject({ method: 'POST', url: `${BASE}/${dto.id}/apply`, headers: authHeaders(session), payload: applyBody }),
      app.inject({ method: 'POST', url: `${BASE}/${dto.id}/apply`, headers: authHeaders(session), payload: applyBody }),
    ]);

    const statuses = [first.statusCode, second.statusCode].sort((a, b) => a - b);
    expect(statuses).toEqual([201, 409]);

    const winner = first.statusCode === 201 ? first : second;
    const loser = first.statusCode === 201 ? second : first;
    expect(loser.json<{ code: string }>().code).toBe('ALREADY_APPLIED');
    expect(winner.json<CvApplyResult>().created.experiences).toBe(2);

    const experienceCount = await prisma.experience.count({ where: { profile: { userId: session.userId } } });
    expect(experienceCount).toBe(2); // pas 4 : la creation n_a eu lieu qu_une seule fois
  });

  it('relance avec succes un import en echec (retry)', async () => {
    const session = await registerUser();
    fakeMessages.parse.mockRejectedValueOnce(new Anthropic.AnthropicError('sortie brute non conforme'));

    const failedUpload = await uploadFixture(session, PDF_FIXTURE, 'cv-demo.pdf', 'application/pdf');
    expect(failedUpload.statusCode).toBe(201);
    const failedDto = failedUpload.json<CvImportDto>();
    expect(failedDto.status).toBe('FAILED');
    expect(failedDto.error).toBeTruthy();

    const retryResponse = await app.inject({
      method: 'POST',
      url: `${BASE}/${failedDto.id}/retry`,
      headers: authHeaders(session),
    });

    expect(retryResponse.statusCode).toBe(201);
    const retried = retryResponse.json<CvImportDto>();
    expect(retried.status).toBe('EXTRACTED');
    expect(retried.error).toBeNull();
  });

  it('supprime un import : suppression puis 404 a la relecture', async () => {
    const session = await registerUser();
    const upload = await uploadFixture(session, PDF_FIXTURE, 'cv-demo.pdf', 'application/pdf');
    const dto = upload.json<CvImportDto>();

    const remove = await app.inject({ method: 'DELETE', url: `${BASE}/${dto.id}`, headers: authHeaders(session) });
    expect(remove.statusCode).toBe(204);

    const after = await app.inject({ method: 'GET', url: `${BASE}/${dto.id}`, headers: authHeaders(session) });
    expect(after.statusCode).toBe(404);
  });

  it('refuse d_appliquer un import deja supprime (404)', async () => {
    const session = await registerUser();
    const upload = await uploadFixture(session, PDF_FIXTURE, 'cv-demo.pdf', 'application/pdf');
    const dto = upload.json<CvImportDto>();
    const remove = await app.inject({ method: 'DELETE', url: `${BASE}/${dto.id}`, headers: authHeaders(session) });
    expect(remove.statusCode).toBe(204);

    const response = await app.inject({
      method: 'POST',
      url: `${BASE}/${dto.id}/apply`,
      headers: authHeaders(session),
      payload: EMPTY_APPLY_BODY,
    });

    expect(response.statusCode).toBe(404);
    expect(response.json<{ code: string }>().code).toBe('IMPORT_NOT_FOUND');
  });

  it('refuse un second import tant que le precedent est en cours (IMPORT_IN_PROGRESS)', async () => {
    const session = await registerUser();
    await prisma.cvImport.create({
      data: {
        userId: session.userId,
        fileName: 'en-cours.pdf',
        mimeType: 'application/pdf',
        sizeBytes: 10,
        storageKey: `${session.userId}/${randomUUID()}.pdf`,
        status: 'PENDING',
      },
    });

    const response = await uploadFixture(session, PDF_FIXTURE, 'cv-demo.pdf', 'application/pdf');

    expect(response.statusCode).toBe(409);
    expect(response.json<{ code: string }>().code).toBe('IMPORT_IN_PROGRESS');
  });
});

describe('Import de CV — service IA non configure', () => {
  it('annonce ai:false', async () => {
    const session = await registerUser(unconfiguredApp);

    const response = await unconfiguredApp.inject({
      method: 'GET',
      url: `${BASE}/capabilities`,
      headers: authHeaders(session),
    });

    expect(response.statusCode).toBe(200);
    expect(response.json<{ ai: boolean }>().ai).toBe(false);
  });

  it('refuse tout upload (503 AI_NOT_CONFIGURED) sans stocker ni ecrire de ligne', async () => {
    const session = await registerUser(unconfiguredApp);

    const response = await uploadFixture(session, PDF_FIXTURE, 'cv-demo.pdf', 'application/pdf', unconfiguredApp);

    expect(response.statusCode).toBe(503);
    expect(response.json<{ code: string }>().code).toBe('AI_NOT_CONFIGURED');

    const rows = await prisma.cvImport.count({ where: { userId: session.userId } });
    expect(rows).toBe(0);
    expect(await readdir(unconfiguredStorageDir)).toHaveLength(0);
  });
});
