import { resolve } from 'node:path';
import { PrismaClient } from '@prisma/client';
import { config as loadDotenv } from 'dotenv';
import { assertDevDatabase } from './guard-dev-database';

loadDotenv({ path: [resolve(process.cwd(), '.env'), resolve(process.cwd(), '../../.env')] });

/**
 * Purge les offres semées par `seed-jobs-fixtures.ts` (identifiants `FT-` des
 * fixtures). Ne supprime jamais un orphelin non scopé : une offre n'est purgée
 * que si TOUTES ses sources sont `FT-` (jamais une offre par ailleurs suivie
 * par une vraie source, même si elle a aussi été touchée par le semis), les
 * identifiants sont capturés avant la suppression des sources — après coup,
 * `sources: { none: {} }` ne distinguerait plus une offre qui n'a jamais eu
 * que des sources `FT-` d'une offre orpheline pour toute autre raison.
 */
async function main(): Promise<void> {
  assertDevDatabase();

  const prisma = new PrismaClient();
  try {
    const jobs = await prisma.job.findMany({
      where: { sources: { every: { externalId: { startsWith: 'FT-' } } } },
      select: { id: true },
    });
    const jobIds = jobs.map((job) => job.id);

    const sources = await prisma.jobSource.deleteMany({ where: { externalId: { startsWith: 'FT-' } } });
    const deletedJobs = await prisma.job.deleteMany({ where: { id: { in: jobIds } } });
    console.log(`Purge des offres fictives : ${sources.count} source(s), ${deletedJobs.count} offre(s).`);
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((error: unknown) => {
  console.error(error);
  process.exitCode = 1;
});
