import { resolve } from 'node:path';
import { PrismaClient } from '@prisma/client';
import { config as loadDotenv } from 'dotenv';

loadDotenv({ path: [resolve(process.cwd(), '.env'), resolve(process.cwd(), '../../.env')] });

/** Purge les offres semées par `seed-jobs-fixtures.ts` (identifiants `FT-` des fixtures). */
async function main(): Promise<void> {
  const prisma = new PrismaClient();
  try {
    const sources = await prisma.jobSource.deleteMany({ where: { externalId: { startsWith: 'FT-' } } });
    const jobs = await prisma.job.deleteMany({ where: { sources: { none: {} } } });
    console.log(`Purge des offres fictives : ${sources.count} source(s), ${jobs.count} offre(s).`);
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((error: unknown) => {
  console.error(error);
  process.exitCode = 1;
});
