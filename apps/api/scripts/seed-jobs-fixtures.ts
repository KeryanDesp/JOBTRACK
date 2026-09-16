import { resolve } from 'node:path';
import { config as loadDotenv } from 'dotenv';
import { PrismaService } from '../src/common/prisma.service';
import { JobIngestionService } from '../src/modules/jobs/job-ingestion.service';
import { mapFranceTravailOffer } from '../src/modules/jobs/sources/france-travail/france-travail.mapper';
import { FakeConnector } from '../src/modules/jobs/testing/fake-connector';

loadDotenv({ path: [resolve(process.cwd(), '.env'), resolve(process.cwd(), '../../.env')] });

/**
 * Semis de développement : ingère les offres **fictives** des fixtures France
 * Travail (entreprises inventées) par le vrai pipeline (mapper + ingestion),
 * pour exercer `/jobs` sans identifiants. Jamais en production : les offres
 * portent des identifiants `FT-` reconnaissables et se purgent avec
 * `pnpm --filter @jobtrack/api jobs:unseed`. Les services sont instanciés à la
 * main (pas de conteneur Nest : `tsx` n'émet pas les métadonnées de décorateurs).
 */
async function main(): Promise<void> {
  const prisma = new PrismaService();
  await prisma.$connect();
  try {
    const offers = await new FakeConnector().search({});
    const drafts = offers.flatMap((offer) => {
      const draft = mapFranceTravailOffer(offer.raw);
      return draft ? [draft] : [];
    });
    const report = await new JobIngestionService(prisma).upsertMany(drafts);
    console.log(`Semis des offres fictives : ${JSON.stringify(report)}`);
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((error: unknown) => {
  console.error(error);
  process.exitCode = 1;
});
