import type { LanguageLevel, SkillLevel } from '@prisma/client';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { PrismaService } from '../../common/prisma.service';
import type { RedisService } from '../../common/redis.service';
import { CommuneService } from '../jobs/commune.service';
import { normalizeForKey } from '../jobs/lib/text';
import { ProfileInputsService } from './profile-inputs.service';
import { computeExperienceYears } from './scoring';

const prisma = new PrismaService();
// `search()` (seule méthode utilisée par `ProfileInputsService`) ne touche ni `redis` ni
// `connectors` : un objet vide typé par cast suffit, même philosophie que les faux services
// étroits de `job-analysis.service.spec.ts` (`fakeRedis`).
const communeService = new CommuneService(prisma, {} as unknown as RedisService, []);
const service = new ProfileInputsService(prisma, communeService);

// Préfixes distinctifs par processus : deux workers vitest ne partagent jamais les mêmes lignes.
const EMAIL_PREFIX = `matching-profile-inputs-${process.pid}-`;
const COMMUNE_PREFIX = `e2e-match-${process.pid}-`;

function email(suffix: string): string {
  return `${EMAIL_PREFIX}${suffix}@jobtrack.local`;
}

async function cleanup(): Promise<void> {
  await prisma.user.deleteMany({ where: { email: { startsWith: EMAIL_PREFIX } } });
  await prisma.commune.deleteMany({ where: { code: { startsWith: COMMUNE_PREFIX } } });
}

beforeEach(cleanup);
afterAll(async () => {
  await cleanup();
  await prisma.$disconnect();
});

interface ProfileSeed {
  city?: string;
  skills?: { name: string; level?: SkillLevel }[];
  experiences?: { company: string; role: string; startDate: Date; endDate?: Date | null; isCurrent?: boolean }[];
  educations?: { school: string; degree: string; startDate: Date }[];
  languages?: { name: string; level: LanguageLevel }[];
  locations?: string[];
}

async function createUserWithProfile(suffix: string, seed: ProfileSeed = {}): Promise<{ userId: string; profileId: string }> {
  const user = await prisma.user.create({
    data: {
      email: email(suffix),
      profile: {
        create: {
          firstName: 'Test',
          lastName: 'Profil',
          city: seed.city,
          skills: seed.skills
            ? { create: seed.skills.map((skill) => ({ name: skill.name, level: skill.level ?? 'INTERMEDIATE' })) }
            : undefined,
          experiences: seed.experiences
            ? {
                create: seed.experiences.map((experience) => ({
                  ...experience,
                  endDate: experience.endDate ?? null,
                  isCurrent: experience.isCurrent ?? false,
                })),
              }
            : undefined,
          educations: seed.educations ? { create: seed.educations } : undefined,
          languages: seed.languages ? { create: seed.languages } : undefined,
          preferences: seed.locations ? { create: { locations: seed.locations } } : undefined,
        },
      },
    },
  });
  const profile = await prisma.profile.findUniqueOrThrow({ where: { userId: user.id } });
  return { userId: user.id, profileId: profile.id };
}

async function createCommune(code: string, name: string, departmentCode: string): Promise<void> {
  await prisma.commune.create({ data: { code, name, nameNormalized: normalizeForKey(name), postalCode: null, departmentCode } });
}

describe('ProfileInputsService', () => {
  it('renvoie null quand l_utilisateur n_a pas de profil', async () => {
    const user = await prisma.user.create({ data: { email: email('no-profile') } });

    const result = await service.build(user.id);

    expect(result).toBeNull();
  });

  it('construit les entrees a partir des competences, technologies de projet, formation et langues', async () => {
    const { userId, profileId } = await createUserWithProfile('full', {
      skills: [{ name: 'React', level: 'ADVANCED' }],
      educations: [{ school: 'Universite', degree: 'Master Informatique', startDate: new Date('2015-09-01') }],
      languages: [{ name: 'Anglais', level: 'B2' }],
    });
    await prisma.project.create({ data: { profileId, name: 'Projet', technologies: ['Docker', 'Kubernetes'] } });

    const result = await service.build(userId);

    expect(result).not.toBeNull();
    expect(result?.profileId).toBe(profileId);
    expect(result?.inputs.skills).toEqual([{ name: 'React', level: 'ADVANCED' }]);
    expect(result?.inputs.projectTechnologies).toEqual(['Docker', 'Kubernetes']);
    expect(result?.inputs.educationLevel).toBe('bac5');
    expect(result?.inputs.languages).toEqual([{ name: 'Anglais', level: 'B2' }]);
    expect(result?.complete).toBe(true);
  });

  it('calcule les annees d_experience a partir des experiences renseignees', async () => {
    const startDate = new Date('2020-01-01');
    const endDate = new Date('2022-01-01');
    const { userId } = await createUserWithProfile('years', {
      experiences: [{ company: 'Acme', role: 'Dev', startDate, endDate, isCurrent: false }],
    });

    const result = await service.build(userId);

    const expected = computeExperienceYears([{ startDate, endDate, isCurrent: false }], new Date());
    expect(result?.inputs.experienceYears).toBe(expected);
  });

  it('retombe sur la saisie manuelle quand aucune experience detaillee n_est renseignee', async () => {
    const user = await prisma.user.create({
      data: {
        email: email('manual-years'),
        profile: { create: { firstName: 'Test', lastName: 'Profil', yearsExperience: 4, skills: { create: [{ name: 'Go' }] } } },
      },
    });

    const result = await service.build(user.id);

    expect(result?.inputs.experienceYears).toBe(4);
  });

  it('est incomplet sans competence ni experience', async () => {
    const { userId } = await createUserWithProfile('incomplete', {});

    const result = await service.build(userId);

    expect(result?.complete).toBe(false);
  });

  it('l_empreinte est stable entre deux constructions successives', async () => {
    const { userId } = await createUserWithProfile('stable', { skills: [{ name: 'Node' }] });
    const now = new Date('2026-09-17T10:00:00Z');

    const first = await service.build(userId, now);
    const second = await service.build(userId, now);

    expect(second?.fingerprint).toBe(first?.fingerprint);
  });

  it('l_empreinte change apres l_ajout d_une competence', async () => {
    const { userId, profileId } = await createUserWithProfile('changed', { skills: [{ name: 'Node' }] });
    const now = new Date('2026-09-17T10:00:00Z');
    const before = await service.build(userId, now);

    await prisma.skill.create({ data: { profileId, name: 'Python' } });
    const after = await service.build(userId, now);

    expect(after?.fingerprint).not.toBe(before?.fingerprint);
  });

  it('ne resout pas une commune au nom seulement proche (Metz / Metzeresche)', async () => {
    await createCommune(`${COMMUNE_PREFIX}metzeresche`, `${COMMUNE_PREFIX}Metzeresche`, 'E2E');
    const { userId } = await createUserWithProfile('near-miss', {
      skills: [{ name: 'Java' }],
      locations: [`${COMMUNE_PREFIX}Metz`],
    });

    const result = await service.build(userId);

    expect(result?.inputs.preferredCommuneCodes).toEqual([]);
    expect(result?.inputs.preferredDepartmentCodes).toEqual([]);
  });

  it('resout une commune au nom exact et deduit son departement', async () => {
    await createCommune(`${COMMUNE_PREFIX}metzeresche`, `${COMMUNE_PREFIX}Metzeresche`, 'E2E');
    await createCommune(`${COMMUNE_PREFIX}metz`, `${COMMUNE_PREFIX}Metz`, 'E2E-DEPT');
    const { userId } = await createUserWithProfile('exact', {
      skills: [{ name: 'Java' }],
      locations: [`${COMMUNE_PREFIX}Metz`],
    });

    const result = await service.build(userId);

    expect(result?.inputs.preferredCommuneCodes).toEqual([`${COMMUNE_PREFIX}metz`]);
    expect(result?.inputs.preferredDepartmentCodes).toEqual(['E2E-DEPT']);
  });

  it('resout aussi la ville du profil, sans doublon avec les lieux souhaites', async () => {
    await createCommune(`${COMMUNE_PREFIX}metz`, `${COMMUNE_PREFIX}Metz`, 'E2E-DEPT');
    const { userId } = await createUserWithProfile('city', {
      skills: [{ name: 'Java' }],
      city: `${COMMUNE_PREFIX}Metz`,
      locations: [`${COMMUNE_PREFIX}Metz`],
    });

    const result = await service.build(userId);

    expect(result?.inputs.preferredCommuneCodes).toEqual([`${COMMUNE_PREFIX}metz`]);
  });
});
