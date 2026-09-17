import type { Prisma } from '@prisma/client';
import type { ApplicationDto, ApplicationEventDto, MatchScoreSummaryDto } from '@jobtrack/shared';
import { toIsoDate } from './dates';

/** Relations exposées par `ApplicationDto` : l'offre (catalogue partagé), le CV adapté et la
 * lettre (tous deux personnels — `userId` sélectionné pour ne jamais rendre la référence d'un
 * autre utilisateur, spec §8). */
export const APPLICATION_INCLUDE = {
  job: { select: { id: true, title: true, company: true } },
  resume: { select: { id: true, title: true, currentVersion: true, userId: true } },
  coverLetter: { select: { id: true, tone: true, userId: true } },
} satisfies Prisma.ApplicationInclude;

export type ApplicationRow = Prisma.ApplicationGetPayload<{ include: typeof APPLICATION_INCLUDE }>;
export type ApplicationEventRow = Prisma.ApplicationEventGetPayload<Record<string, never>>;

export function toEventDto(row: ApplicationEventRow): ApplicationEventDto {
  return {
    id: row.id,
    type: row.type,
    fromStatus: row.fromStatus,
    toStatus: row.toStatus,
    note: row.note,
    createdAt: row.createdAt.toISOString(),
  };
}

export function toApplicationDto(
  userId: string,
  row: ApplicationRow,
  match: MatchScoreSummaryDto | null,
): ApplicationDto {
  // Filet défensif (spec §8) : un CV ou une lettre qui ne serait pas de cet utilisateur n'est
  // jamais exposé — en pratique impossible, les écritures vérifiant la propriété. L'identifiant
  // scalaire suit la référence imbriquée : renvoyer `resumeId` en masquant `resume` laisserait
  // fuiter l'identifiant du document d'un autre, et ferait afficher au web un CV « attaché »
  // qu'aucune route ne lui laisserait ouvrir.
  const resume = row.resume && row.resume.userId === userId ? row.resume : null;
  const coverLetter = row.coverLetter && row.coverLetter.userId === userId ? row.coverLetter : null;

  return {
    id: row.id,
    jobId: row.jobId,
    status: row.status,
    position: row.position,
    jobTitle: row.jobTitle,
    company: row.company,
    locationLabel: row.locationLabel,
    salaryLabel: row.salaryLabel,
    contractLabel: row.contractLabel,
    source: row.source,
    sourceUrl: row.sourceUrl,
    appliedAt: row.appliedAt === null ? null : toIsoDate(row.appliedAt),
    usedBaseResume: row.usedBaseResume,
    resumeId: resume === null ? null : row.resumeId,
    coverLetterId: coverLetter === null ? null : row.coverLetterId,
    notes: row.notes,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
    job: row.job ? { id: row.job.id, title: row.job.title, company: row.job.company, match } : null,
    resume: resume === null ? null : { id: resume.id, title: resume.title, currentVersion: resume.currentVersion },
    coverLetter: coverLetter === null ? null : { id: coverLetter.id, tone: coverLetter.tone },
  };
}
