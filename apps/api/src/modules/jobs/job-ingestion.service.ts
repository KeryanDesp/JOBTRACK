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

/** `skipFingerprintUpdate` : mis à `true` uniquement sur la nouvelle tentative après un `P2002`. */
interface UpsertOptions {
  skipFingerprintUpdate?: boolean;
}

/** Codes moteur Prisma signalant une panne de connectivité (P1xxx) ou un pool épuisé (P2024). */
const CONNECTIVITY_ERROR_CODE_PATTERN = /^P1\d{3}$/;
const CONNECTION_POOL_TIMEOUT_CODE = 'P2024';
const UNIQUE_CONSTRAINT_CODE = 'P2002';

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
        const outcome = await this.runTransaction(draft, now, {});
        report[outcome] += 1;
        continue;
      } catch (error) {
        if (this.isConnectivityError(error)) throw error;

        if (this.isUniqueConstraintViolation(error)) {
          // Course avec un autre appelant (création concurrente de la même empreinte,
          // ou collision d'empreinte recalculée) : une seule nouvelle tentative, qui
          // relit l'état à jour et prend le chemin rattachement/mise à jour.
          try {
            const outcome = await this.runTransaction(draft, now, { skipFingerprintUpdate: true });
            report[outcome] += 1;
            continue;
          } catch (retryError) {
            if (this.isConnectivityError(retryError)) throw retryError;
            this.logIgnored(draft, retryError);
            report.skipped += 1;
            continue;
          }
        }

        this.logIgnored(draft, error);
        report.skipped += 1;
      }
    }

    return report;
  }

  private runTransaction(draft: JobDraft, now: Date, options: UpsertOptions): Promise<IngestionOutcome> {
    return this.prisma.$transaction((tx) => this.upsertOne(tx, draft, now, options));
  }

  /** Jamais le message d'erreur (pourrait, en théorie, porter un fragment de contenu d'offre) : seulement le code. */
  private logIgnored(draft: JobDraft, error: unknown): void {
    this.logger.warn(`Offre ignorée (${draft.source.kind}:${draft.source.externalId}) : ${this.errorLabel(error)}`);
  }

  private errorLabel(error: unknown): string {
    if (error instanceof Prisma.PrismaClientKnownRequestError) return error.code;
    return error instanceof Error ? error.constructor.name : 'Error';
  }

  private async upsertOne(tx: Tx, draft: JobDraft, now: Date, options: UpsertOptions): Promise<IngestionOutcome> {
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
        await this.refreshJob(tx, existingSource.jobId, draft, now, existingSource.job.fingerprint, options);
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
        await this.refreshJob(tx, existingJob.id, draft, now, existingJob.fingerprint, options);
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

  /**
   * Rafraîchit les champs descriptifs d'un `Job` déjà connu. Recalcule aussi son
   * `fingerprint` (titre/entreprise/commune ont pu changer) sauf sur la nouvelle
   * tentative qui suit un `P2002` (`options.skipFingerprintUpdate`) : la collision
   * avec une empreinte déjà prise par un autre `Job` n'est jamais résorbable en
   * retentant, l'ancienne empreinte est alors conservée et journalisée.
   */
  private async refreshJob(
    tx: Tx,
    jobId: string,
    draft: JobDraft,
    now: Date,
    currentFingerprint: string,
    options: UpsertOptions,
  ): Promise<void> {
    const data = { ...buildJobData(draft), lastSeenAt: now, expiredAt: null };
    const newFingerprint = draftFingerprint(draft);
    const fingerprintChanged = newFingerprint !== currentFingerprint;

    if (fingerprintChanged && options.skipFingerprintUpdate) {
      this.logger.warn(
        `Empreinte recalculée en collision pour l'offre ${draft.source.kind}:${draft.source.externalId}, conservée inchangée.`,
      );
    }

    await tx.job.update({
      where: { id: jobId },
      data: fingerprintChanged && !options.skipFingerprintUpdate ? { ...data, fingerprint: newFingerprint } : data,
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

  /**
   * Pannes de connectivité Prisma (moteur inatteignable, panique Rust, requête dont
   * le moteur ne peut pas rendre compte, pool de connexions épuisé) : elles remontent
   * toujours, jamais comptées comme une offre en échec. Une contrainte violée sur une
   * seule offre (P2002 hors nouvelle tentative, contrainte étrangère…) reste locale.
   */
  private isConnectivityError(error: unknown): boolean {
    if (error instanceof Prisma.PrismaClientInitializationError) return true;
    if (error instanceof Prisma.PrismaClientRustPanicError) return true;
    if (error instanceof Prisma.PrismaClientUnknownRequestError) return true;
    if (error instanceof Prisma.PrismaClientKnownRequestError) {
      return CONNECTIVITY_ERROR_CODE_PATTERN.test(error.code) || error.code === CONNECTION_POOL_TIMEOUT_CODE;
    }
    return false;
  }

  private isUniqueConstraintViolation(error: unknown): boolean {
    return error instanceof Prisma.PrismaClientKnownRequestError && error.code === UNIQUE_CONSTRAINT_CODE;
  }
}
