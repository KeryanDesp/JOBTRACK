import { Module } from '@nestjs/common';
import { CommuneService } from './commune.service';
import { JobIngestionService } from './job-ingestion.service';
import { JobSyncService } from './job-sync.service';
import { jobSourceConnectorsProvider } from './sources/france-travail/france-travail.provider';
import { JOB_SOURCE_CONNECTORS } from './sources/job-source.connector';

/**
 * Module `jobs` — connecteurs de sources (tâche 3), ingestion, cache de
 * synchronisation et référentiel des communes (tâche 5). Le contrôleur
 * `/jobs` (liste, détail, favoris, communes) arrive en tâche 6 ; ce module
 * exporte déjà les trois services pour qu'il puisse simplement les injecter.
 */
@Module({
  providers: [jobSourceConnectorsProvider, JobIngestionService, JobSyncService, CommuneService],
  exports: [JOB_SOURCE_CONNECTORS, JobIngestionService, JobSyncService, CommuneService],
})
export class JobsModule {}
