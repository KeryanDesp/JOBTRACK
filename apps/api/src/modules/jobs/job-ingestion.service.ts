import { Injectable, Logger } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../common/prisma.service';
import { draftFingerprint } from './lib/fingerprint';
import type { JobDraft } from './lib/job-draft';

/**
 * Bilan d'un lot d'ingestion (spec §5 et plan tâche 5) : une offre du lot
 * tombe dans exactement une catégorie.
 */
export interface IngestionReport {
  created: number;
  updated: number;
  attached: number;
  unchanged: number;
  skipped: number;
}

type IngestionOutcome = keyof IngestionReport;

type Tx = Prisma.TransactionClient;

function emptyReport(): IngestionReport {
  return { created: 0, updated: 0, attached: 0, unchanged: 0, skipped: 0 };
}

/** `candidate` est-elle strictement postérieure à `stored` ? `null` ne l'est jamais ; toute date bat `null`. */
function isNewer(candidate: Date | null, stored: Date | null): boolean {
  if (!candidate) return false;
  if (!stored) return true;
  return candidate.getTime() > stored.getTime();
}

/** Champs scalaires de `Job` portés par un `JobDraft` (hors `fingerprint`, horodatages d'ingestion). */
function buildJobData(draft: JobDraft): Omit<
  Prisma.JobUncheckedCreateInput,
  'fingerprint' | 'firstSeenAt' | 'lastSeenAt' | 'expiredAt' | 'createdAt' | 'updatedAt' | 'id'
> {
  return {
    title: draft.title,
    company: draft.company,
    companyDescription: draft.companyDescription,
    companyUrl: draft.companyUrl,
    companyLogoUrl: draft.companyLogoUrl,
    description: draft.description,
    locationLabel: draft.locationLabel,
    communeCode: draft.communeCode,
    postalCode: draft.postalCode,
    departmentCode: draft.departmentCode,
    latitude: draft.latitude,
    longitude: draft.longitude,
    contractType: draft.contractType,
    contractLabel: draft.contractLabel,
    contractNature: draft.contractNature,
    remoteMode: draft.remoteMode,
    remoteModeInferred: draft.remoteModeInferred,
    experienceLevel: draft.experienceLevel,
    experienceLabel: draft.experienceLabel,
    experienceRequired: draft.experienceRequired,
    salaryMinAnnual: draft.salaryMinAnnual,
    salaryMaxAnnual: draft.salaryMaxAnnual,
    salaryLabel: draft.salaryLabel,
    currency: draft.currency,
    workingTimeLabel: draft.workingTimeLabel,
    isFullTime: draft.isFullTime,
    isApprenticeship: draft.isApprenticeship,
    positionsCount: draft.positionsCount,
    accessibleTh: draft.accessibleTh,
    sectorLabel: draft.sectorLabel,
    romeCode: draft.romeCode,
    romeLabel: draft.romeLabel,
    qualificationLabel: draft.qualificationLabel,
    publishedAt: draft.publishedAt,
    sourceUpdatedAt: draft.sourceUpdatedAt,
  };
}

function buildSourceCreateData(draft: JobDraft, jobId: string, now: Date): Prisma.JobSourceUncheckedCreateInput {
  return {
    jobId,
    source: draft.source.kind,
    externalId: draft.source.externalId,
    url: draft.source.url,
    applyUrl: draft.source.applyUrl,
    partnerName: draft.source.partnerName,
    publishedAt: draft.source.publishedAt,
    sourceUpdatedAt: draft.source.sourceUpdatedAt,
    lastSeenAt: now,
  };
}

/**
 * Ingestion des offres normalisées (spec §5) : upsert dédoublonné par
 * `(source, externalId)` puis par empreinte (`fingerprint`), avec compétences
 * et exigences remplacées à chaque mise à jour. Jamais bloquant pour le lot :
 * une offre en échec est journalisée (identifiant externe seulement, jamais
 * son contenu) et comptée, sauf panne de connectivité Prisma (rethrow).
 */
@Injectable()
export class JobIngestionService {
  private readonly logger = new Logger(JobIngestionService.name);

  constructor(private readonly prisma: PrismaService) {}

  async upsertMany(drafts: readonly JobDraft[], now: Date = new Date()): Promise<IngestionReport> {
    const report = emptyReport();

    for (const draft of drafts) {
      try {
        const outcome = await this.prisma.$transaction((tx) => this.upsertOne(tx, draft, now));
        report[outcome] += 1;
      } catch (error) {
        if (this.isConnectivityError(error)) throw error;
        this.logger.warn(
          `Offre ignorée (${draft.source.kind}:${draft.source.externalId}) : ${(error as Error).message}`,
        );
        report.skipped += 1;
      }
    }

    return report;
  }

  private async upsertOne(tx: Tx, draft: JobDraft, now: Date): Promise<IngestionOutcome> {
    const existingSource = await tx.jobSource.findUnique({
      where: { source_externalId: { source: draft.source.kind, externalId: draft.source.externalId } },
      include: { job: true },
    });

    if (existingSource) {
      await tx.jobSource.update({
        where: { id: existingSource.id },
        data: {
          url: draft.source.url,
          applyUrl: draft.source.applyUrl,
          partnerName: draft.source.partnerName,
          publishedAt: draft.source.publishedAt,
          sourceUpdatedAt: draft.source.sourceUpdatedAt,
          lastSeenAt: now,
        },
      });

      if (isNewer(draft.source.sourceUpdatedAt, existingSource.sourceUpdatedAt)) {
        await this.refreshJob(tx, existingSource.jobId, draft, now);
        return 'updated';
      }

      await tx.job.update({ where: { id: existingSource.jobId }, data: { lastSeenAt: now, expiredAt: null } });
      return 'unchanged';
    }

    const fingerprint = draftFingerprint(draft);
    const existingJob = await tx.job.findUnique({ where: { fingerprint } });

    if (existingJob) {
      await tx.jobSource.create({ data: buildSourceCreateData(draft, existingJob.id, now) });

      // Le rattachement ne réécrit jamais les champs descriptifs à l'aveugle : seule
      // une source dont l'horodatage bat celui déjà connu peut les rafraîchir.
      if (isNewer(draft.source.sourceUpdatedAt, existingJob.sourceUpdatedAt)) {
        await this.refreshJob(tx, existingJob.id, draft, now);
      } else {
        await tx.job.update({ where: { id: existingJob.id }, data: { lastSeenAt: now, expiredAt: null } });
      }
      return 'attached';
    }

    const job = await tx.job.create({
      data: { ...buildJobData(draft), fingerprint, firstSeenAt: now, lastSeenAt: now },
    });
    await tx.jobSource.create({ data: buildSourceCreateData(draft, job.id, now) });
    await this.replaceSkillsAndRequirements(tx, job.id, draft);
    return 'created';
  }

  private async refreshJob(tx: Tx, jobId: string, draft: JobDraft, now: Date): Promise<void> {
    await tx.job.update({
      where: { id: jobId },
      data: { ...buildJobData(draft), lastSeenAt: now, expiredAt: null },
    });
    await this.replaceSkillsAndRequirements(tx, jobId, draft);
  }

  private async replaceSkillsAndRequirements(tx: Tx, jobId: string, draft: JobDraft): Promise<void> {
    await tx.jobSkill.deleteMany({ where: { jobId } });
    if (draft.skills.length > 0) {
      await tx.jobSkill.createMany({
        data: draft.skills.map((skill) => ({ jobId, name: skill.name, required: skill.required })),
      });
    }

    await tx.jobRequirement.deleteMany({ where: { jobId } });
    if (draft.requirements.length > 0) {
      await tx.jobRequirement.createMany({
        data: draft.requirements.map((requirement) => ({
          jobId,
          kind: requirement.kind,
          label: requirement.label,
          required: requirement.required,
        })),
      });
    }
  }

  /** Seules les pannes de connectivité Prisma remontent : jamais une contrainte violée sur une offre. */
  private isConnectivityError(error: unknown): boolean {
    return (
      error instanceof Prisma.PrismaClientInitializationError || error instanceof Prisma.PrismaClientRustPanicError
    );
  }
}
