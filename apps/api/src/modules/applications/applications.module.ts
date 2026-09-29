import { Module } from '@nestjs/common';
import { MatchingModule } from '../matching/matching.module';
import { ApplicationsAnalyticsService } from './applications-analytics.service';
import { ApplicationsBoardService } from './applications-board.service';
import { ApplicationsController } from './applications.controller';
import { ApplicationsService } from './applications.service';

/**
 * Module « candidatures » (spec §6, tranche 6). `PrismaService`/`RateLimiterService` viennent
 * de `CommonModule` (`@Global()`) ; `MatchingModule` est importé pour `ProfileInputsService`,
 * dont les services se servent pour retrouver le profil et son empreinte courante avant de lire
 * les scores déjà calculés (`MatchScore`) affichés sur les cartes du Kanban et sur la fiche —
 * jamais pour en recalculer un.
 *
 * `ApplicationsBoardService` porte le Kanban et les déplacements de cartes ; `ApplicationsService`
 * lui transmet les deux routes correspondantes, pour que le contrôleur n'ait qu'un service à
 * connaître. La dépendance ne va que dans ce sens (les lectures communes vivent dans `lib/read.ts`),
 * jamais un cycle entre les deux. `ApplicationsAnalyticsService` (écran « Statistiques ») lit
 * `ApplicationsService` pour ses compteurs et n'est pas relayé par lui : le contrôleur
 * connaît les deux, ce qui évite le cycle qu'une délégation créerait.
 *
 * Aucun autre module n'importe celui-ci : rien à exporter.
 */
@Module({
  imports: [MatchingModule],
  controllers: [ApplicationsController],
  providers: [ApplicationsAnalyticsService, ApplicationsBoardService, ApplicationsService],
})
export class ApplicationsModule {}
