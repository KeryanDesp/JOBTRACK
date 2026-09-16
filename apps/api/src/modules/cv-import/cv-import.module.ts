import { Module } from '@nestjs/common';
import { CvApplyService } from './cv-apply.service';
import { CvExtractionService } from './cv-extraction.service';
import { CvImportController } from './cv-import.controller';
import { CvImportService } from './cv-import.service';

// `ANTHROPIC_CLIENT`/`FILE_STORAGE`/`PrismaService` viennent de `CommonModule` (`@Global()`) :
// pas besoin de l'importer ici. Pas de dépendance sur `ProfileModule` : `CvApplyService`
// écrit directement via `PrismaService` (transaction), il ne réutilise pas `ProfileService`.
@Module({
  controllers: [CvImportController],
  providers: [CvImportService, CvApplyService, CvExtractionService],
})
export class CvImportModule {}
