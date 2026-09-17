import { Module } from '@nestjs/common';
import { CoverLetterService } from './cover-letter.service';
import { CoverLetterStoreService } from './cover-letter-store.service';
import { ResumeController } from './resume.controller';
import { ResumeSourceService } from './resume-source.service';
import { ResumeTailoringService } from './resume-tailoring.service';
import { ResumeService } from './resume.service';

// `ANTHROPIC_CLIENT`/`PrismaService`/`RedisService` viennent de `CommonModule` (`@Global()`) :
// pas besoin de l'importer ici (même remarque que `MatchingModule`/`CvImportModule`). Contrôleur
// et services de persistance des routes `/resume/*` (spec §6). Aucun autre module n'important
// `ResumeModule`, ces services n'ont pas besoin d'être exportés (revue finale).
@Module({
  controllers: [ResumeController],
  providers: [ResumeSourceService, ResumeTailoringService, CoverLetterService, ResumeService, CoverLetterStoreService],
})
export class ResumeModule {}
