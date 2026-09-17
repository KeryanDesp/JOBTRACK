import { Module } from '@nestjs/common';
import { JobAnalysisService } from './job-analysis.service';
import { MatchingController } from './matching.controller';
import { MatchService } from './match.service';
import { ProfileInputsService } from './profile-inputs.service';

// `ANTHROPIC_CLIENT`/`PrismaService`/`RedisService` viennent de `CommonModule` (`@Global()`) :
// pas besoin de l'importer ici (même remarque que `CvImportModule`). Pas d'import de `JobsModule` :
// `ProfileInputsService` résout désormais les communes directement via `PrismaService` (résolution
// batch, tâche 5 — amendement revue), sans dépendre de `CommuneService`.
@Module({
  controllers: [MatchingController],
  providers: [JobAnalysisService, ProfileInputsService, MatchService],
  exports: [JobAnalysisService, ProfileInputsService, MatchService],
})
export class MatchingModule {}
