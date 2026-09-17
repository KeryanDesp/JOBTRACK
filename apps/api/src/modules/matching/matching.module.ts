import { Module } from '@nestjs/common';
import { JobsModule } from '../jobs/jobs.module';
import { JobAnalysisService } from './job-analysis.service';
import { MatchService } from './match.service';
import { ProfileInputsService } from './profile-inputs.service';

// `ANTHROPIC_CLIENT`/`PrismaService`/`RedisService` viennent de `CommonModule` (`@Global()`) :
// pas besoin de l'importer ici (même remarque que `CvImportModule`). `JobsModule` est importé
// pour son seul export `CommuneService` (résolution des lieux souhaités du profil, tâche 5) ;
// `JobsModule` n'importe pas `MatchingModule` en retour, pas de cycle à ce jour.
@Module({
  imports: [JobsModule],
  providers: [JobAnalysisService, ProfileInputsService, MatchService],
  exports: [JobAnalysisService, ProfileInputsService, MatchService],
})
export class MatchingModule {}
