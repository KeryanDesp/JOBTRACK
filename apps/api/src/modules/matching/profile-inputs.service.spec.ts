import type { LanguageLevel, SkillLevel } from '@prisma/client';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { PrismaService } from '../../common/prisma.service';
import { normalizeForKey } from '../jobs/lib/text';
import { ProfileInputsService } from './profile-inputs.service';
import { computeExperienceYears } from './scoring';

const prisma = new PrismaService();
const service = new ProfileInputsService(prisma);

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

async function createCommune(code: string, name: string, departmentCode: string, postalCode: string | null = null): Promise<void> {
  await prisma.commune.create({ data: { code, name, nameNormalized: normalizeForKey(name), postalCode, departmentCode } });
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

  it('currentProfileFingerprint renvoie la meme empreinte que build', async () => {
    const { userId } = await createUserWithProfile('current-fingerprint', { skills: [{ name: 'Node' }] });
    const now = new Date('2026-09-17T10:00:00Z');

    const built = await service.build(userId, now);
    const fingerprint = await service.currentProfileFingerprint(userId, now);

    expect(fingerprint).toBe(built?.fingerprint);
  });

  it('currentProfileFingerprint renvoie null sans profil', async () => {
    const user = await prisma.user.create({ data: { email: email('current-fingerprint-none') } });

    const fingerprint = await service.currentProfileFingerprint(user.id);

    expect(fingerprint).toBeNull();
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

  it('tronque la ville quand les lieux souhaites remplissent deja la limite (fusion puis troncature)', async () => {
    await createCommune(`${COMMUNE_PREFIX}ville`, `${COMMUNE_PREFIX}Ville`, 'E2E-DEPT');
    // 10 lieux (la limite `MAX_LOCATIONS`) : la ville, ajoutée après fusion, est tronquée et
    // jamais interrogée — même si une commune existe pour elle.
    const locations = Array.from({ length: 10 }, (_, index) => `${COMMUNE_PREFIX}Lieu-Introuvable-${index}`);
    const { userId } = await createUserWithProfile('max-locations', {
      skills: [{ name: 'Java' }],
      city: `${COMMUNE_PREFIX}Ville`,
      locations,
    });

    const result = await service.build(userId);

    expect(result?.inputs.preferredCommuneCodes).toEqual([]);
  });

  it('resout un lieu au format « Nom (departement) » en ignorant le suffixe', async () => {
    await createCommune(`${COMMUNE_PREFIX}metz`, `${COMMUNE_PREFIX}Metz`, '57');
    const { userId } = await createUserWithProfile('paren-suffix', {
      skills: [{ name: 'Java' }],
      locations: [`${COMMUNE_PREFIX}Metz (57)`],
    });

    const result = await service.build(userId);

    expect(result?.inputs.preferredCommuneCodes).toEqual([`${COMMUNE_PREFIX}metz`]);
    expect(result?.inputs.preferredDepartmentCodes).toEqual(['57']);
  });

  it('resout un code postal exact', async () => {
    // Code postal fictif (jamais attribué en France) plutôt qu'un « 57000 » réaliste : contrairement
    // au nom (toujours préfixé par `COMMUNE_PREFIX` avant normalisation), un code postal ne peut pas
    // porter de préfixe — `commune.service.spec.ts` sème déjà un vrai « 57000 » (Metz) sur cette même
    // base partagée, un choix réaliste collisionnerait par intermittence selon l'ordre d'exécution.
    await createCommune(`${COMMUNE_PREFIX}metz-cp`, `${COMMUNE_PREFIX}Metz`, '57', '00001');
    const { userId } = await createUserWithProfile('postal-code', {
      skills: [{ name: 'Java' }],
      locations: ['00001'],
    });

    const result = await service.build(userId);

    expect(result?.inputs.preferredCommuneCodes).toEqual([`${COMMUNE_PREFIX}metz-cp`]);
    expect(result?.inputs.preferredDepartmentCodes).toEqual(['57']);
  });

  it('replie sur le seul departement quand un nom sans correspondance exacte designe plusieurs arrondissements homonymes (Paris)', async () => {
    await createCommune(`${COMMUNE_PREFIX}paris-1`, `${COMMUNE_PREFIX}Paris 1er Arrondissement`, '75');
    await createCommune(`${COMMUNE_PREFIX}paris-2`, `${COMMUNE_PREFIX}Paris 2e Arrondissement`, '75');
    const { userId } = await createUserWithProfile('paris', {
      skills: [{ name: 'Java' }],
      locations: [`${COMMUNE_PREFIX}Paris`],
    });

    const result = await service.build(userId);

    expect(result?.inputs.preferredCommuneCodes).toEqual([]);
    expect(result?.inputs.preferredDepartmentCodes).toEqual(['75']);
  });

  it('ignore un homonyme reparti sur plusieurs departements', async () => {
    await createCommune(`${COMMUNE_PREFIX}homonyme-a`, `${COMMUNE_PREFIX}Sainte Marie`, 'E2E-DEPT-A');
    await createCommune(`${COMMUNE_PREFIX}homonyme-b`, `${COMMUNE_PREFIX}Sainte Marie`, 'E2E-DEPT-B');
    const { userId } = await createUserWithProfile('homonym', {
      skills: [{ name: 'Java' }],
      locations: [`${COMMUNE_PREFIX}Sainte Marie`],
    });

    const result = await service.build(userId);

    expect(result?.inputs.preferredCommuneCodes).toEqual([]);
    expect(result?.inputs.preferredDepartmentCodes).toEqual([]);
  });
});
