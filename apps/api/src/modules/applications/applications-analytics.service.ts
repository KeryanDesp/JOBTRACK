import { Injectable } from '@nestjs/common';
import {
  ANALYTICS_TOP_COMPANIES,
  ANALYTICS_WEEKS,
  type ApplicationAnalyticsDto,
  type ApplicationCompanyCountDto,
  type ApplicationSourceCountDto,
  type ApplicationWeeklyPointDto,
} from '@jobtrack/shared';
import { PrismaService } from '../../common/prisma.service';
import { ApplicationsService } from './applications.service';
import { startOfWeekUtc, todayUtc, toIsoDate } from './lib/dates';

const MS_PER_DAY = 24 * 60 * 60 * 1000;
const MS_PER_WEEK = 7 * MS_PER_DAY;

/**
 * Les `ANALYTICS_WEEKS` derniers lundis (minuit UTC), du plus ancien au plus récent, semaine
 * en cours comprise. L'arithmétique porte sur des semaines entières à partir d'un lundi déjà
 * ramené à minuit UTC par `startOfWeekUtc` : aucun décalage possible au changement d'heure.
 */
function recentWeekStarts(now: Date): Date[] {
  const current = startOfWeekUtc(now);
  return Array.from(
    { length: ANALYTICS_WEEKS },
    (_, index) => new Date(current.getTime() - (ANALYTICS_WEEKS - 1 - index) * MS_PER_WEEK),
  );
}

/**
 * Médiane d'un échantillon non vide, arrondie à l'entier. Sur un nombre pair de valeurs c'est
 * la moyenne des deux valeurs centrales — la médiane plutôt que la moyenne parce qu'une seule
 * candidature restée six mois sans réponse ne doit pas déplacer le chiffre affiché.
 */
function median(values: number[]): number {
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  // `?? 0` : `noUncheckedIndexedAccess` élargit chaque accès indexé à `| undefined`. Les deux
  // index sont pourtant toujours dans les bornes — l'échantillon est non vide par contrat.
  const high = sorted[middle] ?? 0;
  const value = sorted.length % 2 === 1 ? high : ((sorted[middle - 1] ?? 0) + high) / 2;
  return Math.round(value);
}

/**
 * Séries de l'écran « Statistiques » (`GET /applications/analytics`). Séparé de
 * `ApplicationsService` pour la même raison que le Kanban : ce sont des lectures d'agrégat,
 * sans aucune écriture ni règle métier partagée avec le CRUD.
 *
 * La dépendance ne va que dans un sens (analytics → `ApplicationsService`, pour ne pas
 * dupliquer le calcul des compteurs de `stats`) ; c'est le contrôleur qui connaît les deux
 * services, plutôt qu'une délégation qui créerait un cycle entre eux.
 *
 * Toutes les requêtes sont filtrées par `userId` venant de la session, jamais de l'URL.
 */
@Injectable()
export class ApplicationsAnalyticsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly applications: ApplicationsService,
  ) {}

  async analytics(userId: string, now: Date = new Date()): Promise<ApplicationAnalyticsDto> {
    const weekStarts = recentWeekStarts(now);
    // `recentWeekStarts` rend toujours `ANALYTICS_WEEKS` éléments ; le `?? now` ne sert qu'à
    // satisfaire `noUncheckedIndexedAccess`.
    const firstWeekStart = weekStarts[0] ?? startOfWeekUtc(now);

    const [stats, appliedRows, sourceRows, companyRows, interviewRows] = await Promise.all([
      this.applications.stats(userId, now),
      this.prisma.application.findMany({
        where: { userId, appliedAt: { gte: firstWeekStart } },
        select: { appliedAt: true },
      }),
      this.prisma.application.groupBy({
        by: ['source'],
        where: { userId },
        _count: { _all: true },
      }),
      this.prisma.application.groupBy({
        by: ['company'],
        where: { userId, company: { not: null } },
        _count: { _all: true },
        orderBy: { _count: { company: 'desc' } },
        take: ANALYTICS_TOP_COMPANIES,
      }),
      // Premier passage en entretien de chaque candidature datée : `take: 1` sur les
      // évènements triés par date, plutôt que de rapatrier tout l'historique pour n'en
      // garder qu'une ligne.
      this.prisma.application.findMany({
        where: { userId, appliedAt: { not: null }, events: { some: { toStatus: 'INTERVIEW' } } },
        select: {
          appliedAt: true,
          events: {
            where: { toStatus: 'INTERVIEW' },
            orderBy: { createdAt: 'asc' },
            take: 1,
            select: { createdAt: true },
          },
        },
      }),
    ]);

    return {
      ...stats,
      weekly: this.toWeekly(weekStarts, appliedRows),
      bySource: sourceRows
        .map((row): ApplicationSourceCountDto => ({ source: row.source, count: row._count._all }))
        .sort((a, b) => b.count - a.count),
      // `company: { not: null }` filtre déjà côté base ; le `?? ''` ne sert qu'à satisfaire
      // le type `string | null` de la colonne, il n'est jamais atteint.
      topCompanies: companyRows.map(
        (row): ApplicationCompanyCountDto => ({ company: row.company ?? '', count: row._count._all }),
      ),
      medianDaysToInterview: this.toMedianDaysToInterview(interviewRows),
    };
  }

  /** Répartition des envois par semaine : chaque semaine de la fenêtre apparaît, à 0 si vide. */
  private toWeekly(weekStarts: Date[], rows: { appliedAt: Date | null }[]): ApplicationWeeklyPointDto[] {
    const counts = new Map<number, number>(weekStarts.map((weekStart) => [weekStart.getTime(), 0]));

    for (const row of rows) {
      if (row.appliedAt === null) continue;
      // `appliedAt` est déjà à minuit UTC : le lundi de sa semaine se calcule par différence
      // de jours entiers, sans repasser par un fuseau.
      const daysSinceMonday = (row.appliedAt.getUTCDay() + 6) % 7;
      const weekStart = row.appliedAt.getTime() - daysSinceMonday * MS_PER_DAY;
      const current = counts.get(weekStart);
      // Une candidature antidatée hors fenêtre est ignorée plutôt que reportée sur la
      // première semaine, qui afficherait alors un pic qui n'a pas eu lieu.
      if (current !== undefined) counts.set(weekStart, current + 1);
    }

    return weekStarts.map((weekStart) => ({
      weekStart: toIsoDate(weekStart),
      applied: counts.get(weekStart.getTime()) ?? 0,
    }));
  }

  /**
   * Délai médian entre l'envoi et l'entretien, en jours. L'instant de l'évènement est ramené
   * au jour parisien (`todayUtc`) avant la soustraction : les deux bornes sont alors des jours
   * calendaires, et le délai ne dépend plus de l'heure à laquelle le statut a été changé.
   *
   * Un délai négatif (statut passé à « Entretien » avant la date d'envoi saisie à la main)
   * est ramené à 0 : la donnée est incohérente, mais la médiane ne doit pas s'en trouver tirée
   * vers le bas.
   */
  private toMedianDaysToInterview(rows: { appliedAt: Date | null; events: { createdAt: Date }[] }[]): number | null {
    const delays: number[] = [];

    for (const row of rows) {
      const firstInterview = row.events[0];
      if (row.appliedAt === null || firstInterview === undefined) continue;
      const days = (todayUtc(firstInterview.createdAt).getTime() - row.appliedAt.getTime()) / MS_PER_DAY;
      delays.push(Math.max(0, days));
    }

    return delays.length === 0 ? null : median(delays);
  }
}
