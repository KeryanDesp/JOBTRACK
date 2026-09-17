import { readFileSync, readdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { config as loadDotenv } from 'dotenv';
import { jobRequirementsSchema } from '@jobtrack/shared';
import { PrismaService } from '../src/common/prisma.service';
import { JOB_ANALYSIS_VERSION } from '../src/modules/matching/job-analysis.prompt';
import { assertDevDatabase } from './guard-dev-database';

loadDotenv({ path: [resolve(process.cwd(), '.env'), resolve(process.cwd(), '../../.env')] });

/**
 * Semis de développement : pose des analyses `DONE` **fictives** (fixtures
 * `fixtures/matching/requirements-FT-xxxx.json`) sur les offres semées par
 * `jobs:seed`, pour voir des scores de correspondance sans clé Anthropic.
 * Jamais en production (même garde que `jobs:seed`) ; se purge avec `jobs:unseed`
 * (cascade) ou en supprimant les lignes `JobAnalysis` dont `model = 'fixture'`.
 */
async function main(): Promise<void> {
  assertDevDatabase();
  const prisma = new PrismaService();
  await prisma.$connect();
  try {
    const dir = resolve(__dirname, '../fixtures/matching');
    const files = readdirSync(dir).filter((name) => /^requirements-(FT-\d+)\.json$/.test(name));
    let done = 0;
    for (const file of files) {
      const externalId = file.replace(/^requirements-/, '').replace(/\.json$/, '');
      const source = await prisma.jobSource.findUnique({
        where: { source_externalId: { source: 'FRANCE_TRAVAIL', externalId } },
        select: { jobId: true },
      });
      if (!source) continue;
      const raw: unknown = JSON.parse(readFileSync(resolve(dir, file), 'utf8'));
      const requirements = jobRequirementsSchema.parse(raw);
      await prisma.jobAnalysis.upsert({
        where: { jobId: source.jobId },
        create: {
          jobId: source.jobId,
          status: 'DONE',
          version: JOB_ANALYSIS_VERSION,
          requirements,
          model: 'fixture',
          analyzedAt: new Date(),
        },
        update: { status: 'DONE', version: JOB_ANALYSIS_VERSION, requirements, model: 'fixture', error: null, analyzedAt: new Date() },
      });
      done += 1;
    }
    console.log(`Semis des analyses fictives : ${done} offre(s).`);
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((error: unknown) => {
  console.error(error);
  process.exitCode = 1;
});
