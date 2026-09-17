import { randomUUID } from 'node:crypto';
import { Logger } from '@nestjs/common';
import { Prisma, type ContractType, type Job, type RemoteMode } from '@prisma/client';
import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { PrismaService } from '../../common/prisma.service';
import type { RedisService } from '../../common/redis.service';
import { CommuneService } from '../jobs/commune.service';
import { JOB_ANALYSIS_VERSION } from './job-analysis.prompt';
import type { JobAnalysisService } from './job-analysis.service';
import { MatchService } from './match.service';
import { ProfileInputsService } from './profile-inputs.service';

const prisma = new PrismaService();
// Même philosophie que `job-analysis.service.spec.ts` : un faux service à surface minimale,
// ici réduite à la seule méthode que `MatchService` appelle (`isConfigured`).
function fakeJobAnalysisService(configured: boolean): JobAnalysisService {
  return { isConfigured: () => configured } as unknown as JobAnalysisService;
}
const communeService = new CommuneService(prisma, {} as unknown as RedisService, []);
const profileInputsService = new ProfileInputsService(prisma, communeService);
function createMatchService(configured = true): MatchService {
  return new MatchService(prisma, profileInputsService, fakeJobAnalysisService(configured));
}

// Préfixes distinctifs par processus : deux workers vitest ne partagent jamais les mêmes lignes.
const EMAIL_PREFIX = `matching-match-service-${process.pid}-`;
const FINGERPRINT_PREFIX = `E2E-MATCH-${process.pid}-`;

function email(suffix: string): string {
  return `${EMAIL_PREFIX}${suffix}@jobtrack.local`;
}

async function cleanup(): Promise<void> {
  await prisma.job.deleteMany({ where: { fingerprint: { startsWith: FINGERPRINT_PREFIX } } });
  await prisma.user.deleteMany({ where: { email: { startsWith: EMAIL_PREFIX } } });
}

beforeEach(cleanup);
afterAll(async () => {
  await cleanup();
  await prisma.$disconnect();
});

/**
 * Profil « complet » de référence : une compétence `TypeScript` couverte par l'unique
 * technologie exigée de `VALID_REQUIREMENTS`, une expérience largement suffisante, un niveau
 * de formation qui correspond exactement, et des préférences compatibles avec `createJob` —
 * de quoi obtenir un score `100` déterministe, sans dépendre de la localisation ni des langues
 * (facteurs `unknown` dans ce fixture, spec §5).
 */
async function createCompleteProfile(
  suffix: string,
  overrides: { salaryMin?: number; contractTypes?: ContractType[]; remoteModes?: RemoteMode[] } = {},
): Promise<{ userId: string; profileId: string }> {
  const user = await prisma.user.create({
    data: {
      email: email(suffix),
      profile: {
        create: {
          firstName: 'Test',
          lastName: 'Profil',
          skills: { create: [{ name: 'TypeScript', level: 'ADVANCED' }] },
          experiences: { create: [{ company: 'Acme', role: 'Développeuse', startDate: new Date('2020-01-01'), isCurrent: true }] },
          educations: { create: [{ school: 'Université', degree: 'Licence Informatique', startDate: new Date('2016-09-01') }] },
          preferences: {
            create: {
              salaryMin: overrides.salaryMin ?? 30000,
              contractTypes: overrides.contractTypes ?? ['CDI'],
              remoteModes: overrides.remoteModes ?? ['ONSITE'],
              experienceLevel: 'MID',
            },
          },
        },
      },
    },
  });
  const profile = await prisma.profile.findUniqueOrThrow({ where: { userId: user.id } });
  return { userId: user.id, profileId: profile.id };
}

async function createIncompleteProfile(suffix: string): Promise<{ userId: string; profileId: string }> {
  const user = await prisma.user.create({
    data: { email: email(suffix), profile: { create: { firstName: 'Vide', lastName: 'Profil' } } },
  });
  const profile = await prisma.profile.findUniqueOrThrow({ where: { userId: user.id } });
  return { userId: user.id, profileId: profile.id };
}

async function createJob(overrides: Partial<Prisma.JobUncheckedCreateInput> = {}): Promise<Job> {
  return prisma.job.create({
    data: {
      fingerprint: `${FINGERPRINT_PREFIX}${randomUUID()}`,
      title: 'Ingénieure logicielle',
      description: 'Description de test.',
      publishedAt: new Date('2026-09-16T00:00:00Z'),
      contractType: 'CDI',
      remoteMode: 'ONSITE',
      experienceRequired: true,
      experienceLevel: 'MID',
      salaryMinAnnual: 32000,
      salaryMaxAnnual: 42000,
      sources: {
        create: {
          source: 'FRANCE_TRAVAIL',
          externalId: `${FINGERPRINT_PREFIX}${randomUUID()}`,
          url: 'https://candidat.francetravail.fr/offres/recherche/detail/E2E-MATCH-fictive',
          publishedAt: new Date('2026-09-16T00:00:00Z'),
        },
      },
      ...overrides,
    },
  });
}

/** Exigences valides minimales : une seule technologie exigée (`TypeScript`), couverte par `createCompleteProfile`. */
const VALID_REQUIREMENTS = {
  technologies: [{ name: 'TypeScript', required: true, category: 'language' }],
  softSkills: [],
  experienceYearsMin: 2,
  seniority: null,
  educationLevel: 'bac3',
  educationFields: [],
  languages: [],
  remoteMode: null,
  contractHints: [],
  mustHaves: [],
  niceToHaves: [],
  summary: 'Résumé neutre.',
};

async function createAnalysis(
  jobId: string,
  overrides: Partial<Pick<Prisma.JobAnalysisUncheckedCreateInput, 'status' | 'requirements' | 'error'>> = {},
): Promise<void> {
  await prisma.jobAnalysis.create({
    data: {
      jobId,
      status: overrides.status ?? 'DONE',
      version: JOB_ANALYSIS_VERSION,
      requirements: overrides.requirements ?? VALID_REQUIREMENTS,
      error: overrides.error ?? null,
      analyzedAt: new Date(),
    },
  });
}

describe('MatchService.ensureScores', () => {
  it('renvoie null sans ecrire de ligne quand l_offre n_a pas encore ete analysee', async () => {
    const { userId, profileId } = await createCompleteProfile('no-analysis');
    const job = await createJob();
    const service = createMatchService();

    const { scores, profileComplete } = await service.ensureScores(userId, [job.id]);

    expect(scores[job.id]).toBeNull();
    expect(profileComplete).toBe(true);
    expect(await prisma.matchScore.count({ where: { profileId } })).toBe(0);
  });

  it('calcule et persiste le score quand l_analyse est terminee', async () => {
    const { userId, profileId } = await createCompleteProfile('done');
    const job = await createJob();
    await createAnalysis(job.id);
    const service = createMatchService();

    const { scores } = await service.ensureScores(userId, [job.id]);

    expect(scores[job.id]?.score).toBe(100);
    expect(scores[job.id]?.band).toBe('EXCELLENT');
    const row = await prisma.matchScore.findUniqueOrThrow({ where: { profileId_jobId: { profileId, jobId: job.id } } });
    expect(row.score).toBe(100);
    const payload = row.factors as unknown as { factors: unknown[]; insufficientData: boolean };
    expect(payload.factors).toHaveLength(8);
    expect(payload.insufficientData).toBe(false);
  });

  it('reutilise le score sans recalcul quand rien n_a change', async () => {
    const { userId, profileId } = await createCompleteProfile('reuse');
    const job = await createJob();
    await createAnalysis(job.id);
    const service = createMatchService();

    await service.ensureScores(userId, [job.id], new Date('2026-09-17T08:00:00Z'));
    const first = await prisma.matchScore.findUniqueOrThrow({ where: { profileId_jobId: { profileId, jobId: job.id } } });

    await service.ensureScores(userId, [job.id], new Date('2026-09-17T09:00:00Z'));
    const second = await prisma.matchScore.findUniqueOrThrow({ where: { profileId_jobId: { profileId, jobId: job.id } } });

    // Un recalcul aurait posé `computedAt` à la deuxième date passée : elle reste inchangée.
    expect(second.computedAt).toEqual(first.computedAt);
  });

  it('recalcule apres un changement de profil (empreinte differente)', async () => {
    const { userId, profileId } = await createCompleteProfile('recompute');
    const job = await createJob();
    await createAnalysis(job.id);
    const service = createMatchService();

    await service.ensureScores(userId, [job.id], new Date('2026-09-17T08:00:00Z'));
    const first = await prisma.matchScore.findUniqueOrThrow({ where: { profileId_jobId: { profileId, jobId: job.id } } });

    await prisma.skill.create({ data: { profileId, name: 'Python' } });
    await service.ensureScores(userId, [job.id], new Date('2026-09-17T09:00:00Z'));
    const second = await prisma.matchScore.findUniqueOrThrow({ where: { profileId_jobId: { profileId, jobId: job.id } } });

    expect(second.profileFingerprint).not.toBe(first.profileFingerprint);
    expect(second.computedAt).not.toEqual(first.computedAt);
  });

  it('ne calcule aucun score pour un profil incomplet', async () => {
    const { userId, profileId } = await createIncompleteProfile('incomplete');
    const job = await createJob();
    await createAnalysis(job.id);
    const service = createMatchService();

    const { scores, profileComplete } = await service.ensureScores(userId, [job.id]);

    expect(scores[job.id]).toBeNull();
    expect(profileComplete).toBe(false);
    expect(await prisma.matchScore.count({ where: { profileId } })).toBe(0);
  });

  it('renvoie null et journalise un avertissement quand les exigences stockees sont invalides', async () => {
    const { userId, profileId } = await createCompleteProfile('invalid-requirements');
    const job = await createJob();
    // `[]` n'est pas un objet : `jobRequirementsSchema` (`z.object`) échoue au niveau racine,
    // avant même les transformations tolérantes de chaque champ.
    await createAnalysis(job.id, { requirements: [] });
    const service = createMatchService();
    const warnSpy = vi.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);

    const { scores } = await service.ensureScores(userId, [job.id]);

    expect(scores[job.id]).toBeNull();
    expect(warnSpy).toHaveBeenCalled();
    expect(await prisma.matchScore.count({ where: { profileId } })).toBe(0);
    warnSpy.mockRestore();
  });
});

describe('MatchService.getDetail', () => {
  it('renvoie null quand l_offre n_existe pas', async () => {
    const { userId } = await createCompleteProfile('detail-missing-job');
    const service = createMatchService();

    const result = await service.getDetail(userId, 'offre-inexistante');

    expect(result).toBeNull();
  });

  it('statut none quand l_offre n_est pas analysee et l_IA est configuree', async () => {
    const { userId } = await createCompleteProfile('detail-none');
    const job = await createJob();
    const service = createMatchService(true);

    const detail = await service.getDetail(userId, job.id);

    expect(detail?.analysis).toEqual({ status: 'none', error: null });
    expect(detail?.score).toBeNull();
  });

  it('statut ai_not_configured quand l_offre n_est pas analysee et l_IA n_est pas configuree', async () => {
    const { userId } = await createCompleteProfile('detail-not-configured');
    const job = await createJob();
    const service = createMatchService(false);

    const detail = await service.getDetail(userId, job.id);

    expect(detail?.analysis.status).toBe('ai_not_configured');
  });

  it('statut pending quand l_analyse est en cours', async () => {
    const { userId } = await createCompleteProfile('detail-pending');
    const job = await createJob();
    await createAnalysis(job.id, { status: 'PENDING', requirements: Prisma.DbNull });
    const service = createMatchService();

    const detail = await service.getDetail(userId, job.id);

    expect(detail?.analysis.status).toBe('pending');
    expect(detail?.score).toBeNull();
  });

  it('statut failed avec le message d_erreur quand l_analyse a echoue', async () => {
    const { userId } = await createCompleteProfile('detail-failed');
    const job = await createJob();
    await createAnalysis(job.id, { status: 'FAILED', requirements: Prisma.DbNull, error: 'Analyse en échec.' });
    const service = createMatchService();

    const detail = await service.getDetail(userId, job.id);

    expect(detail?.analysis).toEqual({ status: 'failed', error: 'Analyse en échec.' });
  });

  it('statut done avec le detail complet quand le score est calcule', async () => {
    const { userId } = await createCompleteProfile('detail-done');
    const job = await createJob();
    await createAnalysis(job.id);
    const service = createMatchService();

    const detail = await service.getDetail(userId, job.id);

    expect(detail?.analysis).toEqual({ status: 'done', error: null });
    expect(detail?.score).toBe(100);
    expect(detail?.factors).toHaveLength(8);
    expect(detail?.computedAt).not.toBeNull();
    expect(detail?.profileComplete).toBe(true);
    expect(detail?.insufficientData).toBe(false);
  });
});
