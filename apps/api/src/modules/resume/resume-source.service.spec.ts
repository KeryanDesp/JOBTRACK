import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { PrismaService } from '../../common/prisma.service';
import { ResumeSourceService } from './resume-source.service';

const prisma = new PrismaService();
const service = new ResumeSourceService(prisma);

// Un seul email par processus vitest : deux workers ne partagent jamais le même compte.
const EMAIL = `e2e-resume-source-${process.pid}@jobtrack.local`;

async function resetUser(): Promise<void> {
  await prisma.user.deleteMany({ where: { email: EMAIL } });
}

beforeEach(resetUser);

afterAll(async () => {
  await resetUser();
  await prisma.$disconnect();
});

describe('ResumeSourceService', () => {
  it("renvoie null si l_utilisateur n_existe pas", async () => {
    const result = await service.loadBase('utilisateur-inexistant-resume-source');
    expect(result).toBeNull();
  });

  it('renvoie null si le compte existe mais n_a pas encore de profil', async () => {
    const user = await prisma.user.create({ data: { email: EMAIL } });

    const result = await service.loadBase(user.id);

    expect(result).toBeNull();
  });

  it('profil sans experience ni competence -> complete=false', async () => {
    const user = await prisma.user.create({
      data: { email: EMAIL, profile: { create: { firstName: 'Camille', lastName: 'Martin' } } },
    });

    const result = await service.loadBase(user.id);

    expect(result?.complete).toBe(false);
  });

  it('une seule competence suffit a rendre le profil complet', async () => {
    const user = await prisma.user.create({
      data: {
        email: EMAIL,
        profile: {
          create: {
            firstName: 'Camille',
            lastName: 'Martin',
            skills: { create: { name: 'TypeScript', sortOrder: 0 } },
          },
        },
      },
    });

    const result = await service.loadBase(user.id);

    expect(result?.complete).toBe(true);
    expect(result?.content.skills).toHaveLength(1);
  });

  it('une seule experience suffit aussi a rendre le profil complet', async () => {
    const user = await prisma.user.create({
      data: {
        email: EMAIL,
        profile: {
          create: {
            firstName: 'Camille',
            lastName: 'Martin',
            experiences: {
              create: { company: 'Acme', role: 'Développeuse', startDate: new Date('2020-01-01T00:00:00Z'), isCurrent: true, sortOrder: 0 },
            },
          },
        },
      },
    });

    const result = await service.loadBase(user.id);

    expect(result?.complete).toBe(true);
  });

  it('content conserve email/telephone, aiContent les retire (spec §5/§8)', async () => {
    const user = await prisma.user.create({
      data: {
        email: EMAIL,
        profile: {
          create: {
            firstName: 'Camille',
            lastName: 'Martin',
            phone: '0102030405',
            skills: { create: { name: 'TypeScript', sortOrder: 0 } },
          },
        },
      },
    });

    const result = await service.loadBase(user.id);

    expect(result?.content.identity.email).toBe(EMAIL);
    expect(result?.content.identity.phone).toBe('0102030405');
    expect(result?.aiContent.identity.email).toBeUndefined();
    expect(result?.aiContent.identity.phone).toBeUndefined();
    // Ville/pays ne sont pas des coordonnées de contact : jamais retirés (absents ici, donc `undefined` dans les deux variantes).
    expect(result?.aiContent.identity.city).toBeUndefined();
  });

  it('convertit les dates @db.Date (experiences, formations, certifications) en AAAA-MM-JJ', async () => {
    const user = await prisma.user.create({
      data: {
        email: EMAIL,
        profile: {
          create: {
            firstName: 'Camille',
            lastName: 'Martin',
            experiences: {
              create: {
                company: 'Acme',
                role: 'Développeuse',
                startDate: new Date('2020-03-15T00:00:00Z'),
                endDate: new Date('2022-06-30T00:00:00Z'),
                isCurrent: false,
                sortOrder: 0,
              },
            },
            certifications: {
              create: { name: 'AWS Certified', issuer: 'Amazon', issuedAt: new Date('2023-05-01T00:00:00Z'), sortOrder: 0 },
            },
          },
        },
      },
    });

    const result = await service.loadBase(user.id);

    expect(result?.content.experiences[0]?.startDate).toBe('2020-03-15');
    expect(result?.content.experiences[0]?.endDate).toBe('2022-06-30');
    expect(result?.content.certifications[0]?.issuedAt).toBe('2023-05-01');
  });

  it("l_identifiant renvoye est celui du profil, reutilisable pour l_ancrage (memes ids que les collections)", async () => {
    const user = await prisma.user.create({
      data: {
        email: EMAIL,
        profile: {
          create: {
            firstName: 'Camille',
            lastName: 'Martin',
            skills: { create: { name: 'TypeScript', sortOrder: 0 } },
          },
        },
      },
    });
    const profile = await prisma.profile.findUniqueOrThrow({ where: { userId: user.id } });

    const result = await service.loadBase(user.id);

    expect(result?.profileId).toBe(profile.id);
  });
});
