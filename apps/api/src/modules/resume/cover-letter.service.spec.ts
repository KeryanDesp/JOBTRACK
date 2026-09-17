import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { ConflictException, Logger, NotFoundException } from '@nestjs/common';
import Anthropic from '@anthropic-ai/sdk';
import { COVER_LETTER_MAX_CHARS } from '@jobtrack/shared';
import type { Job, Prisma } from '@prisma/client';
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { AnthropicClient } from '../../common/anthropic.provider';
import { PrismaService } from '../../common/prisma.service';
import { rateLimitKey } from '../../common/rate-limit.guard';
import { RateLimiterService } from '../../common/rate-limiter.service';
import type { RedisService } from '../../common/redis.service';
import { CoverLetterService } from './cover-letter.service';
import { COVER_LETTER_RATE_LIMIT } from './resume.constants';
import { AiNotConfiguredError, AiOutputInvalidError, AiUnavailableError, ProfileIncompleteError, RateLimitedError } from './resume.errors';
import { ResumeSourceService } from './resume-source.service';

const prisma = new PrismaService();
const resumeSource = new ResumeSourceService(prisma);

const EMAIL = `e2e-cover-letter-${process.pid}@jobtrack.local`;
const JOB_FINGERPRINT_PREFIX = `E2E-RESUME-LETTER-${process.pid}-`;
const SECRET_MARKER = `SECRET-COVER-LETTER-${process.pid}`;

async function resetAll(): Promise<void> {
  await prisma.user.deleteMany({ where: { email: EMAIL } });
  await prisma.job.deleteMany({ where: { fingerprint: { startsWith: JOB_FINGERPRINT_PREFIX } } });
}

beforeEach(resetAll);

afterAll(async () => {
  await resetAll();
  await prisma.$disconnect();
});

interface ProfileFixture {
  userId: string;
}

async function createProfile(overrides: { withSkill?: boolean } = { withSkill: true }): Promise<ProfileFixture> {
  const user = await prisma.user.create({
    data: {
      email: EMAIL,
      profile: {
        create: {
          firstName: 'Alex',
          lastName: 'Dupont',
          phone: '0102030405',
          summary: `Ingénieur logiciel backend. ${SECRET_MARKER}`,
          experiences: overrides.withSkill
            ? {
                create: {
                  company: 'Solaris Ingénierie',
                  role: 'Ingénieur logiciel',
                  startDate: new Date('2021-01-01T00:00:00Z'),
                  isCurrent: true,
                  description: `Conception de services backend chez Solaris Ingénierie. ${SECRET_MARKER}`,
                  sortOrder: 0,
                },
              }
            : undefined,
          skills: overrides.withSkill ? { create: { name: 'TypeScript', sortOrder: 0 } } : undefined,
        },
      },
    },
  });
  return { userId: user.id };
}

async function createJob(overrides: Partial<Prisma.JobCreateInput> = {}): Promise<Job> {
  return prisma.job.create({
    data: {
      fingerprint: `${JOB_FINGERPRINT_PREFIX}${randomUUID()}`,
      title: 'Ingénieur logiciel senior',
      company: 'Solaris Ingénierie',
      description: 'Nous recherchons un ingénieur logiciel senior pour renforcer nos équipes.',
      contractLabel: 'CDI',
      experienceLabel: '5 An(s) et plus',
      publishedAt: new Date('2026-09-01T00:00:00Z'),
      ...overrides,
    },
  });
}

const FIXTURE_PATH = join(process.cwd(), 'fixtures', 'resume', 'letter-professional.json');

function loadLetterFixture(): Record<string, unknown> {
  return JSON.parse(readFileSync(FIXTURE_PATH, 'utf-8')) as Record<string, unknown>;
}

interface FakeParsedMessage {
  model: string;
  stop_reason: Anthropic.StopReason;
  parsed_output: unknown;
  usage: { input_tokens: number; output_tokens: number };
}

type Parse = (params: Anthropic.MessageCreateParamsNonStreaming) => Promise<FakeParsedMessage>;

function fakeClient(parse: ReturnType<typeof vi.fn<Parse>>): AnthropicClient {
  return { messages: { parse } } as unknown as Anthropic;
}

function fakeParse(overrides: Partial<FakeParsedMessage> = {}): ReturnType<typeof vi.fn<Parse>> {
  return vi.fn<Parse>().mockResolvedValue({
    model: 'claude-opus-5',
    stop_reason: 'end_turn',
    parsed_output: {},
    usage: { input_tokens: 700, output_tokens: 250 },
    ...overrides,
  });
}

/** Distingue les deux scripts Lua évalués par ce service : `UNLOCK_SCRIPT` (verrou, compare-and-
 * delete par jeton) et `INCREMENT_SCRIPT` (`RateLimiterService.hit`, budget) — reconnus par leur
 * commande Redis dominante (`DEL`/`INCR`). */
function fakeRedis(): RedisService {
  const store = new Map<string, string>();
  const counters = new Map<string, number>();
  const client = {
    set: vi.fn((key: string, value: string, ...args: unknown[]) => {
      if (args.includes('NX') && store.has(key)) return Promise.resolve(null);
      store.set(key, value);
      return Promise.resolve('OK');
    }),
    eval: vi.fn((script: string, _numKeys: number, key: string, arg: string) => {
      if (script.includes('INCR')) {
        const next = (counters.get(key) ?? 0) + 1;
        counters.set(key, next);
        return Promise.resolve(next);
      }
      if (store.get(key) === arg) {
        store.delete(key);
        return Promise.resolve(1);
      }
      return Promise.resolve(0);
    }),
  };
  return { client } as unknown as RedisService;
}

/** `RateLimiterService` adossé à un `fakeRedis()` indépendant de celui du verrou de chaque test —
 * budget toujours neuf, donc jamais épuisé par défaut. */
function fakeRateLimiter(): RateLimiterService {
  return new RateLimiterService(fakeRedis());
}

function lockKeyFor(userId: string, jobId: string): string {
  return `resume:letter:${userId}:${jobId}`;
}

// Phrase entièrement grounded par construction : aucun chiffre, aucun mot capitalisé hors début
// de phrase — `isGrounded` renvoie donc toujours `ok: true`, quelles que soient les sources.
const NEUTRAL_SENTENCE =
  "je souhaite mettre mes compétences au service de votre équipe et contribuer activement aux projets à venir tout en poursuivant mon apprentissage avec rigueur.";

describe('CoverLetterService', () => {
  const logSpies = [
    vi.spyOn(Logger.prototype, 'log').mockImplementation(() => undefined),
    vi.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined),
    vi.spyOn(Logger.prototype, 'error').mockImplementation(() => undefined),
    vi.spyOn(Logger.prototype, 'debug').mockImplementation(() => undefined),
  ];

  afterEach(() => {
    for (const spy of logSpies) spy.mockClear();
  });

  function assertNoLeakedContent(): void {
    for (const spy of logSpies) {
      for (const call of spy.mock.calls) {
        for (const arg of call) {
          expect(String(arg)).not.toContain(SECRET_MARKER);
        }
      }
    }
  }

  it("génère une lettre à partir de la fixture livrée : signature forcée au nom complet du profil", async () => {
    const profile = await createProfile();
    const job = await createJob();
    const parse = fakeParse({ parsed_output: loadLetterFixture() });
    const service = new CoverLetterService(prisma, fakeRedis(), resumeSource, fakeRateLimiter(), fakeClient(parse));

    const result = await service.write(profile.userId, job.id, 'PROFESSIONAL');

    // La fixture porte « Camille Martin » : jamais reprise telle quelle, toujours le nom du profil.
    expect(result.content.signature).toBe('Alex Dupont');
    expect(result.model).toBe('claude-opus-5');
    expect(result.promptVersion).toBe(1);
    expect(result.content.paragraphs.length).toBeGreaterThan(0);
  });

  it("conserve le destinataire propose quand il figure litteralement dans l_offre", async () => {
    const profile = await createProfile();
    const job = await createJob({ description: 'Contactez Madame Sophie Legrand pour toute question sur ce poste.' });
    const letter = { ...loadLetterFixture(), recipient: 'Madame Sophie Legrand' };
    const parse = fakeParse({ parsed_output: letter });
    const service = new CoverLetterService(prisma, fakeRedis(), resumeSource, fakeRateLimiter(), fakeClient(parse));

    const result = await service.write(profile.userId, job.id, 'PROFESSIONAL');

    expect(result.content.recipient).toBe('Madame Sophie Legrand');
  });

  it("retire un destinataire invente, absent du texte de l_offre", async () => {
    const profile = await createProfile();
    const job = await createJob();
    const letter = { ...loadLetterFixture(), recipient: 'Madame Sophie Legrand' };
    const parse = fakeParse({ parsed_output: letter });
    const service = new CoverLetterService(prisma, fakeRedis(), resumeSource, fakeRateLimiter(), fakeClient(parse));

    const result = await service.write(profile.userId, job.id, 'PROFESSIONAL');

    expect(result.content.recipient).toBeNull();
  });

  it('plafonne la longueur totale selon le ton demandé (SHORT ≤ 900 caractères)', async () => {
    const profile = await createProfile();
    const job = await createJob();
    const longLetter = {
      recipient: null,
      subject: 'Candidature',
      greeting: 'Madame, Monsieur,',
      paragraphs: [NEUTRAL_SENTENCE, NEUTRAL_SENTENCE, NEUTRAL_SENTENCE, NEUTRAL_SENTENCE, NEUTRAL_SENTENCE, NEUTRAL_SENTENCE],
      closing: 'Cordialement.',
      signature: 'Alex Dupont',
    };
    const parse = fakeParse({ parsed_output: longLetter });
    const service = new CoverLetterService(prisma, fakeRedis(), resumeSource, fakeRateLimiter(), fakeClient(parse));

    const result = await service.write(profile.userId, job.id, 'SHORT');

    const totalLength = result.content.paragraphs.join(' ').length;
    expect(totalLength).toBeLessThanOrEqual(COVER_LETTER_MAX_CHARS.SHORT);
    expect(result.content.paragraphs.length).toBeGreaterThan(0);
  });

  it('retire une phrase non ancrée (chiffre et entité absents du profil et de l_offre)', async () => {
    const profile = await createProfile();
    const job = await createJob();
    const letter = {
      recipient: null,
      subject: 'Candidature',
      greeting: 'Madame, Monsieur,',
      paragraphs: [
        `${NEUTRAL_SENTENCE} Nous avons signé un contrat de 500000 euros avec Umbrella Corp.`,
      ],
      closing: 'Cordialement.',
      signature: 'Alex Dupont',
    };
    const parse = fakeParse({ parsed_output: letter });
    const service = new CoverLetterService(prisma, fakeRedis(), resumeSource, fakeRateLimiter(), fakeClient(parse));

    const result = await service.write(profile.userId, job.id, 'PROFESSIONAL');

    const text = result.content.paragraphs.join(' ');
    expect(text).not.toContain('500000');
    expect(text).not.toContain('Umbrella Corp');
  });

  it("les coordonnées (email, téléphone) ne figurent jamais dans le prompt envoyé au modèle", async () => {
    const profile = await createProfile();
    const job = await createJob();
    const parse = fakeParse({ parsed_output: loadLetterFixture() });
    const service = new CoverLetterService(prisma, fakeRedis(), resumeSource, fakeRateLimiter(), fakeClient(parse));

    await service.write(profile.userId, job.id, 'PROFESSIONAL');

    const params = parse.mock.calls[0]?.[0];
    const sentContent = JSON.stringify(params?.messages);
    expect(sentContent).not.toContain(EMAIL);
    expect(sentContent).not.toContain('0102030405');
  });

  it('service IA non configuré : AiNotConfiguredError, aucun appel au modèle', async () => {
    const profile = await createProfile();
    const job = await createJob();
    const service = new CoverLetterService(prisma, fakeRedis(), resumeSource, fakeRateLimiter(), null);

    await expect(service.write(profile.userId, job.id, 'SHORT')).rejects.toBeInstanceOf(AiNotConfiguredError);
  });

  it('service indisponible (panne réseau) : AiUnavailableError', async () => {
    const profile = await createProfile();
    const job = await createJob();
    const connectionError = new Anthropic.APIConnectionError({ message: 'panne réseau' });
    const parse = vi.fn<Parse>().mockRejectedValue(connectionError);
    const service = new CoverLetterService(prisma, fakeRedis(), resumeSource, fakeRateLimiter(), fakeClient(parse));

    await expect(service.write(profile.userId, job.id, 'SHORT')).rejects.toBeInstanceOf(AiUnavailableError);
  });

  it('sortie tronquée (`stop_reason: max_tokens`) : AiOutputInvalidError', async () => {
    const profile = await createProfile();
    const job = await createJob();
    const parse = fakeParse({ stop_reason: 'max_tokens', parsed_output: null });
    const service = new CoverLetterService(prisma, fakeRedis(), resumeSource, fakeRateLimiter(), fakeClient(parse));

    await expect(service.write(profile.userId, job.id, 'SHORT')).rejects.toBeInstanceOf(AiOutputInvalidError);
  });

  it('sortie hors schéma (paragraphes manquants) : AiOutputInvalidError', async () => {
    const profile = await createProfile();
    const job = await createJob();
    const parse = fakeParse({ parsed_output: { recipient: null, subject: '', greeting: '', paragraphs: [], closing: '', signature: '' } });
    const service = new CoverLetterService(prisma, fakeRedis(), resumeSource, fakeRateLimiter(), fakeClient(parse));

    await expect(service.write(profile.userId, job.id, 'SHORT')).rejects.toBeInstanceOf(AiOutputInvalidError);
  });

  it('sujet compose uniquement de caracteres de controle (non vide, donc jamais retenu par callClaude) : AiOutputInvalidError une fois nettoye (revue securite)', async () => {
    // `\u0000\u0000` (longueur 2) passe `coverLetterContentSchema.safeParse` dans `callClaude`
    // (`.trim()` ne retire pas les caracteres de controle) ; c_est seulement une fois nettoye par
    // `stripControlChars`, dans `groundLetter`, que `subject` devient une chaine vide — doit
    // toujours remonter en `AiOutputInvalidError` (502), jamais une `ZodError` brute (500).
    const profile = await createProfile();
    const job = await createJob();
    const fixture = loadLetterFixture();
    fixture.subject = '\u0000\u0000';
    const parse = fakeParse({ parsed_output: fixture });
    const service = new CoverLetterService(prisma, fakeRedis(), resumeSource, fakeRateLimiter(), fakeClient(parse));

    await expect(service.write(profile.userId, job.id, 'SHORT')).rejects.toBeInstanceOf(AiOutputInvalidError);
  });

  it('verrou déjà détenu par un autre appelant : ConflictException, aucun appel au modèle', async () => {
    const profile = await createProfile();
    const job = await createJob();
    const redis = fakeRedis();
    await redis.client.set(lockKeyFor(profile.userId, job.id), 'un-autre-jeton', 'PX', 120_000, 'NX');
    const parse = fakeParse({ parsed_output: loadLetterFixture() });
    const service = new CoverLetterService(prisma, redis, resumeSource, fakeRateLimiter(), fakeClient(parse));

    await expect(service.write(profile.userId, job.id, 'SHORT')).rejects.toBeInstanceOf(ConflictException);
    expect(parse).not.toHaveBeenCalled();
  });

  it('budget épuisé (seau cover-letter) : RateLimitedError, aucun appel au modèle', async () => {
    const profile = await createProfile();
    const job = await createJob();
    const rateLimiter = new RateLimiterService(fakeRedis());
    const key = rateLimitKey(COVER_LETTER_RATE_LIMIT.bucket, `user:${profile.userId}`);
    for (let i = 0; i < COVER_LETTER_RATE_LIMIT.limit; i += 1) {
      await rateLimiter.hit(key, COVER_LETTER_RATE_LIMIT.limit, COVER_LETTER_RATE_LIMIT.windowSeconds);
    }
    const parse = fakeParse({ parsed_output: loadLetterFixture() });
    const service = new CoverLetterService(prisma, fakeRedis(), resumeSource, rateLimiter, fakeClient(parse));

    await expect(service.write(profile.userId, job.id, 'SHORT')).rejects.toBeInstanceOf(RateLimitedError);
    expect(parse).not.toHaveBeenCalled();
  });

  it('offre introuvable : ne consomme jamais le budget (compté après le contrôle offre)', async () => {
    const profile = await createProfile();
    const rateLimiter = new RateLimiterService(fakeRedis());
    const key = rateLimitKey(COVER_LETTER_RATE_LIMIT.bucket, `user:${profile.userId}`);
    const service = new CoverLetterService(prisma, fakeRedis(), resumeSource, rateLimiter, fakeClient(fakeParse()));

    await expect(service.write(profile.userId, 'offre-inexistante-lettre', 'SHORT')).rejects.toBeInstanceOf(NotFoundException);

    const check = await rateLimiter.hit(key, COVER_LETTER_RATE_LIMIT.limit, COVER_LETTER_RATE_LIMIT.windowSeconds);
    expect(check.count).toBe(1);
  });

  it('profil sans expérience ni compétence : ProfileIncompleteError', async () => {
    const profile = await createProfile({ withSkill: false });
    const job = await createJob();
    const service = new CoverLetterService(prisma, fakeRedis(), resumeSource, fakeRateLimiter(), fakeClient(fakeParse()));

    await expect(service.write(profile.userId, job.id, 'SHORT')).rejects.toBeInstanceOf(ProfileIncompleteError);
  });

  it('offre introuvable : NotFoundException', async () => {
    const profile = await createProfile();
    const service = new CoverLetterService(prisma, fakeRedis(), resumeSource, fakeRateLimiter(), fakeClient(fakeParse()));

    await expect(service.write(profile.userId, 'offre-inexistante-lettre', 'SHORT')).rejects.toBeInstanceOf(NotFoundException);
  });

  it("les journaux ne contiennent jamais le contenu du profil ou de l'offre", async () => {
    const profile = await createProfile();
    const job = await createJob({ description: `Offre. ${SECRET_MARKER}` });
    const parse = fakeParse({ parsed_output: loadLetterFixture() });
    const service = new CoverLetterService(prisma, fakeRedis(), resumeSource, fakeRateLimiter(), fakeClient(parse));

    await service.write(profile.userId, job.id, 'PROFESSIONAL', 'un-resume-id');

    assertNoLeakedContent();
  });
});
