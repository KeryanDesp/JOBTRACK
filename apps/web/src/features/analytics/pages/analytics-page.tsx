import { APPLICATION_SOURCE_LABELS } from '@jobtrack/shared';
import { BarChart3, Clock, Percent, Send, Target } from 'lucide-react';
import type { ReactNode } from 'react';
import { useNavigate } from 'react-router-dom';
import { EmptyState } from '@/components/shared/empty-state';
import { ErrorState } from '@/components/shared/error-state';
import { PageHeader } from '@/components/shared/page-header';
import { StatTile, StatTileSkeleton } from '@/components/shared/stat-tile';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import { useApplicationAnalytics } from '@/features/applications/hooks/use-applications';
import { PipelineBar } from '@/features/dashboard/components/pipeline-bar';
import { BreakdownList } from '../components/breakdown-list';
import { WeeklyChart } from '../components/weekly-chart';

/** Taux d'entretien (0–1 côté API) en pourcentage entier, tiret quand le dénominateur est vide. */
function formatRate(rate: number | null): string {
  return rate === null ? '—' : `${Math.round(rate * 100)} %`;
}

/** Délai médian en jours ; le tiret tant qu'aucune candidature datée n'a atteint l'entretien. */
function formatDays(days: number | null): string {
  if (days === null) return '—';
  return `${days} j`;
}

/**
 * Statistiques (`/analytics`) : la même lecture que le tableau de bord, mais dans le temps et
 * par axe (semaine, source, entreprise). Tous les chiffres viennent d'un seul appel
 * (`GET /applications/analytics`), qui reprend lui-même les compteurs de `/applications/stats` —
 * les deux pages ne peuvent donc pas afficher deux totaux différents.
 */
export function AnalyticsPage() {
  const navigate = useNavigate();
  const analytics = useApplicationAnalytics();

  let content: ReactNode;
  if (analytics.isPending) {
    content = (
      <div className="space-y-6" role="status" aria-busy="true">
        <span className="sr-only">Chargement des statistiques…</span>
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          <StatTileSkeleton />
          <StatTileSkeleton />
          <StatTileSkeleton />
          <StatTileSkeleton />
        </div>
        <Skeleton className="h-64 w-full" />
      </div>
    );
  } else if (analytics.isError) {
    content = <ErrorState message="Impossible de charger vos statistiques." onRetry={() => void analytics.refetch()} />;
  } else if (analytics.data.total === 0) {
    content = (
      <EmptyState
        icon={BarChart3}
        title="Pas encore de statistiques."
        description="Suivez vos premières candidatures : les chiffres apparaîtront dès la première enregistrée."
        action={{ label: 'Parcourir les offres', onClick: () => navigate('/jobs') }}
      />
    );
  } else {
    const data = analytics.data;
    content = (
      <div className="space-y-6">
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          <StatTile label="Candidatures" value={data.total} icon={Send} hint="Toutes périodes confondues" />
          <StatTile label="Entretiens obtenus" value={data.byStatus.INTERVIEW + data.byStatus.OFFER} icon={Target} hint="Entretiens et offres" />
          <StatTile
            label="Taux d'entretien"
            value={formatRate(data.interviewRate)}
            icon={Percent}
            hint="Sur les candidatures traitées"
          />
          <StatTile
            label="Délai médian"
            value={formatDays(data.medianDaysToInterview)}
            icon={Clock}
            hint="De l'envoi au premier entretien"
          />
        </div>

        <Card>
          <CardHeader>
            <CardTitle className="text-base">Candidatures envoyées par semaine</CardTitle>
          </CardHeader>
          <CardContent>
            <WeeklyChart weeks={data.weekly} />
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="text-base">Répartition par statut</CardTitle>
          </CardHeader>
          <CardContent>
            <PipelineBar byStatus={data.byStatus} total={data.total} />
          </CardContent>
        </Card>

        <div className="grid gap-6 lg:grid-cols-2">
          <Card>
            <CardHeader>
              <CardTitle className="text-base">Par source</CardTitle>
            </CardHeader>
            <CardContent>
              <BreakdownList
                rows={data.bySource.map((row) => ({
                  key: row.source,
                  label: APPLICATION_SOURCE_LABELS[row.source],
                  count: row.count,
                }))}
                emptyLabel="Aucune source enregistrée."
              />
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="text-base">Entreprises les plus sollicitées</CardTitle>
            </CardHeader>
            <CardContent>
              <BreakdownList
                rows={data.topCompanies.map((row) => ({ key: row.company, label: row.company, count: row.count }))}
                emptyLabel="Aucune entreprise renseignée sur vos candidatures."
              />
            </CardContent>
          </Card>
        </div>
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-6xl">
      <PageHeader title="Statistiques" description="L'avancement de votre recherche, semaine après semaine." />
      {content}
    </div>
  );
}
