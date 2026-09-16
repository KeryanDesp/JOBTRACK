import { ConflictException, NotFoundException } from '@nestjs/common';
import type { CvApplyInput } from '@jobtrack/shared';
import type { CvImportStatus } from '@prisma/client';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { PrismaService } from '../../common/prisma.service';
import { CvApplyService } from './cv-apply.service';

const prisma = new PrismaService();
const service = new CvApplyService(prisma);

// Suffixe par processus : deux workers vitest ne doivent pas partager le meme email.
const EMAIL = `cv-apply-${process.pid}@jobtrack.local`;

const EMPTY_INPUT: CvApplyInput = {
  identity: {},
  experiences: [],
  educations: [],
  skills: [],
  languages: [],
  certifications: [],
  projects: [],
  preferences: {},
};

async function resetUser(): Promise<void> {
  await prisma.user.deleteMany({ where: { email: EMAIL } });
}

async function createUserWithProfile(): Promise<{ userId: string; profileId: string }> {
  const user = await prisma.user.create({
    data: { email: EMAIL, profile: { create: { firstName: 'Camille', lastName: 'Demo' } } },
  });
  const profile = await prisma.profile.findUniqueOrThrow({ where: { userId: user.id } });
  return { userId: user.id, profileId: profile.id };
}

async function createImport(userId: string, status: CvImportStatus = 'EXTRACTED'): Promise<string> {
  const row = await prisma.cvImport.create({
    data: {
      userId,
      fileName: 'cv.pdf',
      mimeType: 'application/pdf',
      sizeBytes: 10,
      storageKey: `${userId}/fixture.pdf`,
      status,
    },
  });
  return row.id;
}

beforeEach(resetUser);

afterAll(async () => {
  await resetUser();
  await prisma.$disconnect();
});

describe('CvApplyService', () => {
  it('ne cree que les entrees selectionnees', async () => {
    const { userId, profileId } = await createUserWithProfile();
    const importId = await createImport(userId);
    const input: CvApplyInput = {
      ...EMPTY_INPUT,
      experiences: [
        {
          selected: true,
          item: { company: 'Acme', role: 'Développeuse', startDate: '2022-01-01', endDate: null, isCurrent: true, description: null },
        },
        {
          selected: false,
          item: { company: 'Ignoree', role: 'Stagiaire', startDate: '2019-01-01', endDate: null, isCurrent: true, description: null },
        },
      ],
    };

    const result = await service.apply(userId, importId, input);

    expect(result.created.experiences).toBe(1);
    const rows = await prisma.experience.findMany({ where: { profileId } });
    expect(rows).toHaveLength(1);
    expect(rows[0]?.company).toBe('Acme');
  });

  it('ajoute apres les entrees existantes (sortOrder croissant)', async () => {
    const { userId, profileId } = await createUserWithProfile();
    const importId = await createImport(userId);
    await prisma.experience.create({
      data: { profileId, company: 'Deja-la', role: 'Role', startDate: new Date('2018-01-01'), isCurrent: true, sortOrder: 0 },
    });
    const input: CvApplyInput = {
      ...EMPTY_INPUT,
      experiences: [
        {
          selected: true,
          item: { company: 'Nouvelle', role: 'Role2', startDate: '2022-01-01', endDate: null, isCurrent: true, description: null },
        },
      ],
    };

    await service.apply(userId, importId, input);

    const added = await prisma.experience.findFirstOrThrow({ where: { profileId, company: 'Nouvelle' } });
    expect(added.sortOrder).toBe(1);
  });

  it('fusionne les preferences sans doublon (insensible a la casse)', async () => {
    const { userId, profileId } = await createUserWithProfile();
    const importId = await createImport(userId);
    await prisma.jobPreferences.create({ data: { profileId, desiredRoles: ['Développeuse', 'DevOps'] } });
    const input: CvApplyInput = {
      ...EMPTY_INPUT,
      preferences: { desiredRoles: ['développeuse', 'Backend'] },
    };

    await service.apply(userId, importId, input);

    const preferences = await prisma.jobPreferences.findUniqueOrThrow({ where: { profileId } });
    expect(preferences.desiredRoles).toEqual(['Développeuse', 'DevOps', 'Backend']);
  });

  it('refuse une seconde application (conflit)', async () => {
    const { userId } = await createUserWithProfile();
    const importId = await createImport(userId);

    await service.apply(userId, importId, EMPTY_INPUT);

    await expect(service.apply(userId, importId, EMPTY_INPUT)).rejects.toBeInstanceOf(ConflictException);
    const stored = await prisma.cvImport.findUniqueOrThrow({ where: { id: importId } });
    expect(stored.status).toBe('APPLIED');
    expect(stored.appliedAt).not.toBeNull();
  });

  it('refuse un import qui n_est pas encore extrait', async () => {
    const { userId } = await createUserWithProfile();
    const importId = await createImport(userId, 'PENDING');

    await expect(service.apply(userId, importId, EMPTY_INPUT)).rejects.toBeInstanceOf(ConflictException);
  });

  it('renvoie une 404 pour un import appartenant a un autre utilisateur', async () => {
    const { userId: owner } = await createUserWithProfile();
    const importId = await createImport(owner);

    await expect(service.apply('un-autre-utilisateur', importId, EMPTY_INPUT)).rejects.toBeInstanceOf(
      NotFoundException,
    );
  });
});
