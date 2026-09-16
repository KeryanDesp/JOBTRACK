import { Module } from '@nestjs/common';
import { jobSourceConnectorsProvider } from './sources/france-travail/france-travail.provider';
import { JOB_SOURCE_CONNECTORS } from './sources/job-source.connector';

/**
 * Module `jobs` — pour l'instant limité aux connecteurs de sources (tâche 3).
 * Le contrôleur `/jobs` (liste, détail, favoris, communes) arrive en tâche 6 ;
 * ce module minimal permet aux tâches suivantes (mapper, ingestion) d'injecter
 * `JOB_SOURCE_CONNECTORS` sans dépendre d'un contrôleur qui n'existe pas encore.
 */
@Module({
  providers: [jobSourceConnectorsProvider],
  exports: [JOB_SOURCE_CONNECTORS],
})
export class JobsModule {}
