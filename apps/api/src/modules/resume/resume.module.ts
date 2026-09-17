import { Module } from '@nestjs/common';
import { CoverLetterService } from './cover-letter.service';
import { ResumeSourceService } from './resume-source.service';
import { ResumeTailoringService } from './resume-tailoring.service';

// `ANTHROPIC_CLIENT`/`PrismaService`/`RedisService` viennent de `CommonModule` (`@Global()`) :
// pas besoin de l'importer ici (même remarque que `MatchingModule`/`CvImportModule`). Pas de
// contrôleur pour l'instant : les routes `/resume/*` (spec §6) sont posées par la tâche 5, qui
// complètera ce module.
@Module({
  providers: [ResumeSourceService, ResumeTailoringService, CoverLetterService],
  exports: [ResumeSourceService, ResumeTailoringService, CoverLetterService],
})
export class ResumeModule {}
