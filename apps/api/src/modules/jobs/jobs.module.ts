import { Module } from '@nestjs/common';
import { CommuneService } from './commune.service';
import { JobIngestionService } from './job-ingestion.service';
import { JobsController } from './jobs.controller';
import { JobsService } from './jobs.service';
import { JobSyncService } from './job-sync.service';
import { SavedJobsService } from './saved-jobs.service';
import { jobSourceConnectorsProvider } from './sources/france-travail/france-travail.provider';
import { JOB_SOURCE_CONNECTORS } from './sources/job-source.connector';

/**
 * Module `jobs` — connecteurs de sources, ingestion, cache de synchronisation
 * et référentiel des communes (tâches 3 et 5), et le contrôleur `/jobs`
 * (liste, détail, favoris, communes, capacités — tâche 6).
 */
@Module({
  controllers: [JobsController],
  providers: [
    jobSourceConnectorsProvider,
    JobIngestionService,
    JobSyncService,
    CommuneService,
    JobsService,
    SavedJobsService,
  ],
  exports: [JOB_SOURCE_CONNECTORS, JobIngestionService, JobSyncService, CommuneService],
})
export class JobsModule {}
