import { HttpException, HttpStatus, Inject, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import type {
  JobDetailDto,
  JobListResponseDto,
  JobSearchQuery,
  JobSort,
  JobSummaryDto,
  JobsCapabilitiesDto,
} from '@jobtrack/shared';
import { PrismaService } from '../../common/prisma.service';
import { RateLimiterService } from '../../common/rate-limiter.service';
import { JobSyncService } from './job-sync.service';
import { JOB_SOURCE_CONNECTORS, isConfigured, type JobSourceConnector } from './sources/job-source.connector';

const PAGE_SIZE = 20;
const REFRESH_RATE_LIMIT = { limit: 6, windowSeconds: 600 };
const REFRESH_RATE_LIMIT_KEY_PREFIX = 'ratelimit:jobs-sync:user:';
// Une offre non revue depuis plus de 24 h est re-vérifiée auprès de sa source
// au moment du détail (spec §5) — jamais sur la liste, pour ne pas multiplier
// les appels externes à chaque recherche.
const DETAIL_STALE_AFTER_MS = 24 * 60 * 60 * 1000;

/**
 * Champs de `Job` communs à la liste et aux favoris (spec §8 : jamais la
 * description ni les autres champs volumineux sur la liste). `savedBy` est
 * filtré par utilisateur pour que `saved` reflète l'isolation des favoris
 * sans jointure supplémentaire.
 */
export function buildSummarySelect(userId: string) {
  return {
    id: true,
    title: true,
    company: true,
    companyLogoUrl: true,
    locationLabel: true,
    departmentCode: true,
    contractType: true,
    contractLabel: true,
    remoteMode: true,
    remoteModeInferred: true,
    experienceLevel: true,
    salaryMinAnnual: true,
    salaryMaxAnnual: true,
    salaryLabel: true,
    currency: true,
    publishedAt: true,
    expiredAt: true,
    skills: {
      select: { name: true, required: true },
      orderBy: [{ required: 'desc' }, { name: 'asc' }],
      take: 3,
    },
    sources: { select: { source: true } },
    savedBy: { where: { userId }, select: { id: true } },
  } satisfies Prisma.JobSelect;
}

export type JobSummaryRow = Prisma.JobGetPayload<{ select: ReturnType<typeof buildSummarySelect> }>;

export function toSummaryDto(job: JobSummaryRow): JobSummaryDto {
  return {
    id: job.id,
    title: job.title,
    company: job.company,
    companyLogoUrl: job.companyLogoUrl,
    locationLabel: job.locationLabel,
    departmentCode: job.departmentCode,
    contractType: job.contractType,
    contractLabel: job.contractLabel,
    remoteMode: job.remoteMode,
    remoteModeInferred: job.remoteModeInferred,
    experienceLevel: job.experienceLevel,
    salaryMinAnnual: job.salaryMinAnnual,
    salaryMaxAnnual: job.salaryMaxAnnual,
    salaryLabel: job.salaryLabel,
    currency: job.currency,
    publishedAt: job.publishedAt.toISOString(),
    expiredAt: job.expiredAt ? job.expiredAt.toISOString() : null,
    skills: job.skills.map((skill) => skill.name),
    sources: [...new Set(job.sources.map((source) => source.source))],
    saved: job.savedBy.length > 0,
  };
}

function buildDetailSelect(userId: string) {
  return {
    ...buildSummarySelect(userId),
    skills: { select: { name: true, required: true }, orderBy: [{ required: 'desc' }, { name: 'asc' }] },
    sources: {
      select: { source: true, externalId: true, url: true, applyUrl: true, partnerName: true, publishedAt: true },
      orderBy: { publishedAt: 'desc' },
    },
    requirements: { select: { kind: true, label: true, required: true } },
    description: true,
    companyDescription: true,
    companyUrl: true,
    communeCode: true,
    postalCode: true,
    latitude: true,
    longitude: true,
    contractNature: true,
    experienceLabel: true,
    experienceRequired: true,
    workingTimeLabel: true,
    isFullTime: true,
    isApprenticeship: true,
    positionsCount: true,
    accessibleTh: true,
    sectorLabel: true,
    romeCode: true,
    romeLabel: true,
    qualificationLabel: true,
    sourceUpdatedAt: true,
    lastSeenAt: true,
  } satisfies Prisma.JobSelect;
}

type JobDetailRow = Prisma.JobGetPayload<{ select: ReturnType<typeof buildDetailSelect> }>;

function toDetailDto(job: JobDetailRow): JobDetailDto {
  return {
    id: job.id,
    title: job.title,
    company: job.company,
    companyLogoUrl: job.companyLogoUrl,
    locationLabel: job.locationLabel,
    departmentCode: job.departmentCode,
    contractType: job.contractType,
    contractLabel: job.contractLabel,
    remoteMode: job.remoteMode,
    remoteModeInferred: job.remoteModeInferred,
    experienceLevel: job.experienceLevel,
    salaryMinAnnual: job.salaryMinAnnual,
    salaryMaxAnnual: job.salaryMaxAnnual,
    salaryLabel: job.salaryLabel,
    currency: job.currency,
    publishedAt: job.publishedAt.toISOString(),
    expiredAt: job.expiredAt ? job.expiredAt.toISOString() : null,
    saved: job.savedBy.length > 0,
    description: job.description,
    companyDescription: job.companyDescription,
    companyUrl: job.companyUrl,
    communeCode: job.communeCode,
    postalCode: job.postalCode,
    latitude: job.latitude,
    longitude: job.longitude,
    contractNature: job.contractNature,
    experienceLabel: job.experienceLabel,
    experienceRequired: job.experienceRequired,
    workingTimeLabel: job.workingTimeLabel,
    isFullTime: job.isFullTime,
    isApprenticeship: job.isApprenticeship,
    positionsCount: job.positionsCount,
    accessibleTh: job.accessibleTh,
    sectorLabel: job.sectorLabel,
    romeCode: job.romeCode,
    romeLabel: job.romeLabel,
    qualificationLabel: job.qualificationLabel,
    sourceUpdatedAt: job.sourceUpdatedAt ? job.sourceUpdatedAt.toISOString() : null,
    lastSeenAt: job.lastSeenAt.toISOString(),
    skills: job.skills.map((skill) => ({ name: skill.name, required: skill.required })),
    sources: job.sources.map((source) => ({
      kind: source.source,
      externalId: source.externalId,
      url: source.url,
      applyUrl: source.applyUrl,
      partnerName: source.partnerName,
      publishedAt: source.publishedAt.toISOString(),
    })),
    requirements: job.requirements.map((requirement) => ({
      kind: requirement.kind,
      label: requirement.label,
      required: requirement.required,
    })),
  };
}

/** Code département depuis un code commune INSEE (mêmes règles que le mapper France Travail). */
function departmentCodeFromCommuneCode(communeCode: string): string {
  const upper = communeCode.toUpperCase();
  if (upper.startsWith('97') || upper.startsWith('98')) return upper.slice(0, 3);
  return upper.slice(0, 2);
}

function hoursAgo(hours: number, from: Date = new Date()): Date {
  return new Date(from.getTime() - hours * 60 * 60 * 1000);
}

function daysAgo(days: number, from: Date = new Date()): Date {
  return hoursAgo(days * 24, from);
}

/**
 * Service `/jobs` (spec §6 et §8) : synchronisation implicite bornée par le
 * limiteur utilisateur (`refresh`), puis liste locale filtrée/triée depuis la
 * base, détail avec re-vérification d'expiration, et capacités.
 */
@Injectable()
export class JobsService {
  private readonly logger = new Logger(JobsService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly rateLimiter: RateLimiterService,
    private readonly syncService: JobSyncService,
    @Inject(JOB_SOURCE_CONNECTORS) private readonly connectors: JobSourceConnector[],
  ) {}

  async search(userId: string, query: JobSearchQuery): Promise<JobListResponseDto> {
    if (query.refresh) {
      const key = `${REFRESH_RATE_LIMIT_KEY_PREFIX}${userId}`;
      const { allowed } = await this.rateLimiter.hit(key, REFRESH_RATE_LIMIT.limit, REFRESH_RATE_LIMIT.windowSeconds);
      if (!allowed) throw this.refreshRateLimited();
    }

    const sync = await this.syncService.ensureFresh(query, { force: query.refresh });

    const where = this.buildWhere(query);
    const orderBy = this.buildOrderBy(query.sort);
    const skip = (query.page - 1) * PAGE_SIZE;

    const [rows, total] = await this.prisma.$transaction([
      this.prisma.job.findMany({ where, orderBy, skip, take: PAGE_SIZE, select: buildSummarySelect(userId) }),
      this.prisma.job.count({ where }),
    ]);

    return {
      items: rows.map(toSummaryDto),
      total,
      page: query.page,
      pageSize: PAGE_SIZE,
      sync,
    };
  }

  async getDetail(userId: string, id: string): Promise<JobDetailDto> {
    const job = await this.prisma.job.findUnique({ where: { id }, select: buildDetailSelect(userId) });
    if (!job) throw this.notFound();

    const refreshed = await this.refreshIfStale(job);
    return toDetailDto(refreshed);
  }

  capabilities(): JobsCapabilitiesDto {
    return { sources: { franceTravail: isConfigured(this.connectors, 'FRANCE_TRAVAIL') } };
  }

  private buildWhere(query: JobSearchQuery): Prisma.JobWhereInput {
    const and: Prisma.JobWhereInput[] = [{ expiredAt: null }];

    const q = query.q.trim();
    if (q !== '') {
      and.push({
        OR: [{ title: { contains: q, mode: 'insensitive' } }, { company: { contains: q, mode: 'insensitive' } }],
      });
    }

    if (query.communes.length > 0) {
      // Aucune distance n'est calculée localement (pas de coordonnées comparées en base) :
      // au-delà de 0 km, le rayon est approximé en élargissant aux communes ET aux
      // départements des lieux demandés — grossier mais sans coût, jamais présenté comme
      // un rayon exact (spec §5, tâche 6).
      const communeConditions: Prisma.JobWhereInput[] = [{ communeCode: { in: query.communes } }];
      if (query.distance > 0) {
        const departmentCodes = [...new Set(query.communes.map(departmentCodeFromCommuneCode))];
        communeConditions.push({ departmentCode: { in: departmentCodes } });
      }
      and.push({ OR: communeConditions });
    }

    if (query.contractTypes.length > 0) and.push({ contractType: { in: query.contractTypes } });
    if (query.remoteModes.length > 0) and.push({ remoteMode: { in: query.remoteModes } });
    if (query.experienceLevels.length > 0) and.push({ experienceLevel: { in: query.experienceLevels } });

    if (query.salaryMin !== undefined) {
      and.push({
        OR: [{ salaryMaxAnnual: { gte: query.salaryMin } }, { salaryMinAnnual: { gte: query.salaryMin } }],
      });
    }

    if (query.publishedWithinDays !== undefined) {
      and.push({ publishedAt: { gte: daysAgo(query.publishedWithinDays) } });
    }

    if (query.sources.length > 0) and.push({ sources: { some: { source: { in: query.sources } } } });

    // Onglet « Nouvelles » : publiées depuis 24 h (spec §2), indépendant de `publishedWithinDays`.
    if (query.tab === 'new') and.push({ publishedAt: { gte: hoursAgo(24) } });

    return { AND: and };
  }

  private buildOrderBy(sort: JobSort): Prisma.JobOrderByWithRelationInput[] {
    if (sort === 'salary') {
      return [{ salaryMaxAnnual: { sort: 'desc', nulls: 'last' } }, { publishedAt: 'desc' }];
    }
    return [{ publishedAt: 'desc' }, { id: 'asc' }];
  }

  /**
   * Re-vérifie une offre non revue depuis plus de 24 h auprès de sa source, si un
   * connecteur configuré la couvre (spec §5). Toute erreur de la source est
   * journalisée et ignorée : le détail reste servi avec les données déjà connues.
   */
  private async refreshIfStale(job: JobDetailRow): Promise<JobDetailRow> {
    if (job.lastSeenAt.getTime() >= Date.now() - DETAIL_STALE_AFTER_MS) return job;

    const source = job.sources.find((candidate) =>
      this.connectors.some((connector) => connector.kind === candidate.source),
    );
    if (!source) return job;
    const connector = this.connectors.find((candidate) => candidate.kind === source.source);
    if (!connector) return job;

    try {
      const offer = await connector.getOffer(source.externalId);
      const now = new Date();
      if (offer === null) {
        if (job.expiredAt) return job;
        await this.prisma.job.update({ where: { id: job.id }, data: { expiredAt: now } });
        return { ...job, expiredAt: now };
      }
      await this.prisma.job.update({ where: { id: job.id }, data: { lastSeenAt: now, expiredAt: null } });
      return { ...job, lastSeenAt: now, expiredAt: null };
    } catch (error) {
      this.logger.debug(`Vérification de fraîcheur ignorée pour ${job.id} : ${(error as Error).message}`);
      return job;
    }
  }

  private notFound(): NotFoundException {
    return new NotFoundException({ code: 'JOB_NOT_FOUND', message: 'Offre introuvable.' });
  }

  private refreshRateLimited(): HttpException {
    return new HttpException(
      { code: 'RATE_LIMITED', message: "Trop d'actualisations. Réessayez dans quelques minutes." },
      HttpStatus.TOO_MANY_REQUESTS,
    );
  }
}
