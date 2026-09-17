import { Injectable, NotFoundException } from '@nestjs/common';
import type { JobSummaryDto } from '@jobtrack/shared';
import { PrismaService } from '../../common/prisma.service';
import { buildSummarySelect, toSummaryDto } from './jobs.service';

/**
 * Favoris (spec §6) : personnels et isolés par utilisateur (`{userId, jobId}`),
 * jamais 403 — un favori d'un autre utilisateur se comporte comme absent.
 * `save`/`unsave` sont idempotents (spec) : appeler deux fois produit le même
 * état, jamais d'erreur de doublon ni de 404 sur un retrait déjà fait.
 */
@Injectable()
export class SavedJobsService {
  constructor(private readonly prisma: PrismaService) {}

  async save(userId: string, jobId: string): Promise<void> {
    const job = await this.prisma.job.findUnique({ where: { id: jobId }, select: { id: true } });
    if (!job) throw this.notFound();

    await this.prisma.savedJob.upsert({
      where: { userId_jobId: { userId, jobId } },
      create: { userId, jobId },
      update: {},
    });
  }

  async unsave(userId: string, jobId: string): Promise<void> {
    await this.prisma.savedJob.deleteMany({ where: { userId, jobId } });
  }

  async list(userId: string): Promise<JobSummaryDto[]> {
    const savedJobs = await this.prisma.savedJob.findMany({
      where: { userId },
      orderBy: { createdAt: 'desc' },
      select: { job: { select: buildSummarySelect(userId) } },
    });
    return savedJobs.map((saved) => toSummaryDto(saved.job));
  }

  private notFound(): NotFoundException {
    return new NotFoundException({ code: 'JOB_NOT_FOUND', message: 'Offre introuvable.' });
  }
}
