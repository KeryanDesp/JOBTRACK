import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { PrismaService } from '../../common/prisma.service';
import { OnboardingService } from './onboarding.service';

const prisma = new PrismaService();
const service = new OnboardingService(prisma);

// Suffixe par processus : deux workers vitest ne doivent pas partager le meme email.
const EMAIL = `onboarding-${process.pid}@jobtrack.local`;

async function createUser(): Promise<string> {
  const user = await prisma.user.create({ data: { email: EMAIL } });
  return user.id;
}

beforeEach(async () => {
  await prisma.user.deleteMany({ where: { email: EMAIL } });
});

afterAll(async () => {
  await prisma.user.deleteMany({ where: { email: EMAIL } });
  await prisma.$disconnect();
});

describe('OnboardingService', () => {
  it('pose la date de fin d_onboarding', async () => {
    const userId = await createUser();

    await service.complete(userId);

    const stored = await prisma.user.findUniqueOrThrow({ where: { id: userId } });
    expect(stored.onboardingCompletedAt).not.toBeNull();
  });

  it('un second appel ne change pas la date deja posee', async () => {
    const userId = await createUser();

    await service.complete(userId);
    const first = await prisma.user.findUniqueOrThrow({ where: { id: userId } });

    await service.complete(userId);
    const second = await prisma.user.findUniqueOrThrow({ where: { id: userId } });

    expect(second.onboardingCompletedAt).toEqual(first.onboardingCompletedAt);
  });
});
