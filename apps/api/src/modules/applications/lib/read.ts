import type { ApplicationDetailDto, MatchScoreSummaryDto } from '@jobtrack/shared';
import type { PrismaService } from '../../../common/prisma.service';
import type { ProfileInputsService } from '../../matching/profile-inputs.service';
import { JOB_ANALYSIS_VERSION } from '../../matching/job-analysis.prompt';
import { toMatchSummary } from '../../jobs/lib/match-summary';
import { applicationNotFound } from '../applications.errors';
import { APPLICATION_INCLUDE, toApplicationDto, toEventDto } from './dto';

/**
 * Lectures partagées par les deux services du module (`ApplicationsService` pour la fiche,
 * `ApplicationsBoardService` pour le Kanban et le retour d'un déplacement) : des fonctions
 * prenant leurs dépendances en paramètre plutôt qu'un troisième service injecté — les deux
 * services resteraient sinon dépendants l'un de l'autre (`move` renvoie la fiche complète).
 */

/** Évènements renvoyés par la fiche de détail, les plus récents d'abord (l'historique d'une
 * candidature est court par nature ; la borne évite qu'une fiche très ancienne devienne
 * lourde à charger). */
const EVENT_TAKE = 100;

/**
 * Scores de correspondance déjà calculés pour CE profil (spec §4) : lecture seule de
 * `MatchScore`, filtrée par l'empreinte courante du profil et la version d'analyse — comme
 * `JobsService`, une simple consultation ne recalcule jamais de score (`POST /jobs/analyses`
 * et `GET /jobs/:id/match` sont les seules routes qui le font).
 */
export async function loadMatchSummaries(
  prisma: PrismaService,
  profileInputs: ProfileInputsService,
  userId: string,
  jobIds: readonly string[],
): Promise<Map<string, MatchScoreSummaryDto>> {
  const unique = [...new Set(jobIds)];
  const summaries = new Map<string, MatchScoreSummaryDto>();
  if (unique.length === 0) return summaries;

  const profile = await profileInputs.build(userId);
  if (!profile || !profile.complete) return summaries;

  const rows = await prisma.matchScore.findMany({
    where: {
      profileId: profile.profileId,
      profileFingerprint: profile.fingerprint,
      analysisVersion: JOB_ANALYSIS_VERSION,
      jobId: { in: unique },
    },
    select: { jobId: true, score: true, band: true, priority: true, factors: true },
  });
  for (const row of rows) {
    const summary = toMatchSummary(row);
    if (summary) summaries.set(row.jobId, summary);
  }
  return summaries;
}

export function matchOf(
  summaries: Map<string, MatchScoreSummaryDto>,
  row: { jobId: string | null },
): MatchScoreSummaryDto | null {
  return row.jobId === null ? null : (summaries.get(row.jobId) ?? null);
}

/** Fiche de détail (spec §6) : historique antéchronologique, référence d'offre (avec le score
 * de correspondance de CET utilisateur, `null` s'il n'en a pas), CV et lettre. 404 sur la
 * candidature d'un autre utilisateur, jamais un 403 qui en révélerait l'existence. */
export async function loadApplicationDetail(
  prisma: PrismaService,
  profileInputs: ProfileInputsService,
  userId: string,
  id: string,
): Promise<ApplicationDetailDto> {
  const row = await prisma.application.findFirst({ where: { id, userId }, include: APPLICATION_INCLUDE });
  if (!row) throw applicationNotFound();

  const [events, matches] = await Promise.all([
    prisma.applicationEvent.findMany({
      where: { applicationId: row.id },
      // `id` en second critère : deux évènements écrits dans la même transaction (changement
      // de statut + notes) partagent la même milliseconde, leur ordre doit rester stable.
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      take: EVENT_TAKE,
    }),
    loadMatchSummaries(prisma, profileInputs, userId, row.jobId === null ? [] : [row.jobId]),
  ]);

  return { ...toApplicationDto(userId, row, matchOf(matches, row)), events: events.map(toEventDto) };
}
