import { Module } from '@nestjs/common';
import { JobAnalysisService } from './job-analysis.service';

// `ANTHROPIC_CLIENT`/`PrismaService`/`RedisService` viennent de `CommonModule` (`@Global()`) :
// pas besoin de l'importer ici (même remarque que `CvImportModule`).
@Module({
  providers: [JobAnalysisService],
  exports: [JobAnalysisService],
})
export class MatchingModule {}
