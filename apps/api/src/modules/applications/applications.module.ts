import { Module } from '@nestjs/common';
import { MatchingModule } from '../matching/matching.module';
import { ApplicationsController } from './applications.controller';
import { ApplicationsService } from './applications.service';

/**
 * Module « candidatures » (spec §6, tranche 6). `PrismaService`/`RateLimiterService` viennent
 * de `CommonModule` (`@Global()`) ; `MatchingModule` est importé pour `ProfileInputsService`,
 * dont le service se sert pour retrouver le profil et son empreinte courante avant de lire les
 * scores déjà calculés (`MatchScore`) affichés sur les cartes du Kanban et sur la fiche —
 * jamais pour en recalculer un.
 *
 * Aucun autre module n'importe celui-ci : rien à exporter.
 */
@Module({
  imports: [MatchingModule],
  controllers: [ApplicationsController],
  providers: [ApplicationsService],
})
export class ApplicationsModule {}
