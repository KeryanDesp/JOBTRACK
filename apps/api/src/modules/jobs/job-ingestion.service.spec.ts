import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { PrismaService } from '../../common/prisma.service';
import { JobIngestionService } from './job-ingestion.service';
import type { JobDraft } from './lib/job-draft';

const prisma = new PrismaService();
const service = new JobIngestionService(prisma);

// Préfixe distinctif par processus : deux workers vitest ne partagent jamais la même entreprise.
const COMPANY_PREFIX = `Ingestion Test ${process.pid}`;

async function cleanup(): Promise<void> {
  await prisma.job.deleteMany({ where: { company: { startsWith: COMPANY_PREFIX } } });
}

beforeEach(cleanup);
afterAll(async () => {
  await cleanup();
  await prisma.$disconnect();
});

function buildDraft(overrides: Partial<JobDraft> = {}): JobDraft {
  return {
    title: 'Développeuse backend',
    company: `${COMPANY_PREFIX} SA`,
    companyDescription: null,
    companyUrl: null,
    companyLogoUrl: null,
    description: 'Description initiale.',
    locationLabel: 'Metz (57)',
    communeCode: '57463',
    postalCode: '57000',
    departmentCode: '57',
    latitude: null,
    longitude: null,
    contractType: 'CDI',
    contractLabel: 'CDI',
    contractNature: null,
    remoteMode: null,
    remoteModeInferred: false,
    experienceLevel: null,
    experienceLabel: null,
    experienceRequired: null,
    salaryMinAnnual: null,
    salaryMaxAnnual: null,
    salaryLabel: null,
    currency: 'EUR',
    workingTimeLabel: null,
    isFullTime: null,
    isApprenticeship: false,
    positionsCount: null,
    accessibleTh: null,
    sectorLabel: null,
    romeCode: null,
    romeLabel: null,
    qualificationLabel: null,
    publishedAt: new Date('2026-09-01T00:00:00Z'),
    sourceUpdatedAt: new Date('2026-09-01T00:00:00Z'),
    skills: [{ name: 'TypeScript', required: true }],
    requirements: [],
    source: {
      kind: 'FRANCE_TRAVAIL',
      externalId: 'FT-ING-0001',
      url: 'https://candidat.francetravail.fr/offres/recherche/detail/FT-ING-0001',
      applyUrl: null,
      partnerName: null,
      publishedAt: new Date('2026-09-01T00:00:00Z'),
      sourceUpdatedAt: new Date('2026-09-01T00:00:00Z'),
    },
    ...overrides,
  };
}

describe('JobIngestionService.upsertMany', () => {
  it('cree un Job, une JobSource et les competences', async () => {
    const draft = buildDraft();

    const report = await service.upsertMany([draft]);

    expect(report).toEqual({ created: 1, updated: 0, attached: 0, unchanged: 0, skipped: 0 });
    const job = await prisma.job.findFirstOrThrow({ where: { company: draft.company } });

    expect(job.title).toBe('Développeuse backend');
    const skills = await prisma.jobSkill.findMany({ where: { jobId: job.id } });
    expect(skills).toHaveLength(1);
    expect(skills[0]?.name).toBe('TypeScript');
  });

  it('rattache par empreinte deux annonces de meme entreprise/titre/commune', async () => {
    const first = buildDraft({ source: { ...buildDraft().source, externalId: 'FT-ING-A' } });
    const second = buildDraft({ source: { ...buildDraft().source, externalId: 'FT-ING-B' } });

    const report1 = await service.upsertMany([first]);
    const report2 = await service.upsertMany([second]);

    expect(report1.created).toBe(1);
    expect(report2.attached).toBe(1);

    const jobs = await prisma.job.findMany({ where: { company: first.company } });
    expect(jobs).toHaveLength(1);
    const sources = await prisma.jobSource.findMany({ where: { jobId: jobs[0]?.id } });
    expect(sources).toHaveLength(2);
  });

  it('met a jour l_offre et remplace les competences quand sourceUpdatedAt avance', async () => {
    const draft = buildDraft();
    await service.upsertMany([draft]);

    const updated = buildDraft({
      description: 'Description mise a jour.',
      skills: [{ name: 'Node.js', required: true }],
      source: { ...draft.source, sourceUpdatedAt: new Date('2026-09-05T00:00:00Z') },
    });
    const report = await service.upsertMany([updated]);

    expect(report).toEqual({ created: 0, updated: 1, attached: 0, unchanged: 0, skipped: 0 });
    const job = await prisma.job.findFirstOrThrow({ where: { company: draft.company } });
    expect(job.description).toBe('Description mise a jour.');
    const skills = await prisma.jobSkill.findMany({ where: { jobId: job.id } });
    expect(skills.map((skill) => skill.name)).toEqual(['Node.js']);
  });

  it('ne change rien quand sourceUpdatedAt n_avance pas, mais bascule lastSeenAt', async () => {
    const draft = buildDraft();
    await service.upsertMany([draft]);
    const before = await prisma.job.findFirstOrThrow({ where: { company: draft.company } });

    await new Promise((resolve) => setTimeout(resolve, 5));
    const sameOrOlder = buildDraft({
      description: 'Ne doit jamais apparaitre.',
      source: { ...draft.source, sourceUpdatedAt: draft.source.sourceUpdatedAt },
    });
    const report = await service.upsertMany([sameOrOlder]);

    expect(report).toEqual({ created: 0, updated: 0, attached: 0, unchanged: 1, skipped: 0 });
    const after = await prisma.job.findFirstOrThrow({ where: { company: draft.company } });
    expect(after.description).toBe(before.description);
    expect(after.lastSeenAt.getTime()).toBeGreaterThan(before.lastSeenAt.getTime());
  });

  it('efface expiredAt quand une offre expiree reapparait', async () => {
    const draft = buildDraft();
    await service.upsertMany([draft]);
    const job = await prisma.job.findFirstOrThrow({ where: { company: draft.company } });
    await prisma.job.update({ where: { id: job.id }, data: { expiredAt: new Date() } });

    await service.upsertMany([draft]);

    const reappeared = await prisma.job.findUniqueOrThrow({ where: { id: job.id } });
    expect(reappeared.expiredAt).toBeNull();
  });

  it('ignore une offre en echec et poursuit les autres du lot', async () => {
    const good = buildDraft({ source: { ...buildDraft().source, externalId: 'FT-ING-GOOD' } });
    // Deux competences de meme nom pour la meme offre violent la contrainte unique
    // (jobId, name) au moment de l_insertion : une offre malformee, jamais construite
    // par le mapper, mais qui doit rester sans effet sur le reste du lot.
    const bad = buildDraft({
      company: `${COMPANY_PREFIX} SA — mauvaise`,
      source: { ...buildDraft().source, externalId: 'FT-ING-BAD' },
      skills: [
        { name: 'Doublon', required: true },
        { name: 'Doublon', required: false },
      ],
    });

    const report = await service.upsertMany([good, bad]);

    expect(report).toEqual({ created: 1, updated: 0, attached: 0, unchanged: 0, skipped: 1 });
    const goodJob = await prisma.job.findFirst({ where: { company: good.company } });
    expect(goodJob).not.toBeNull();
    const badJob = await prisma.job.findFirst({ where: { company: bad.company } });
    expect(badJob).toBeNull();
  });
});
