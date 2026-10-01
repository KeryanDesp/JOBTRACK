import type { ApplicationListQueryInput } from '@jobtrack/shared';
import { Briefcase, FileText, Percent, Send, Target } from 'lucide-react';
import type { ReactNode } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { EmptyState } from '@/components/shared/empty-state';
import { ErrorState } from '@/components/shared/error-state';
import { PageHeader } from '@/components/shared/page-header';
import { StatTile, StatTileSkeleton } from '@/components/shared/stat-tile';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import { useApplicationStats, useApplications } from '@/features/applications/hooks/use-applications';
import { useSession } from '@/features/auth/hooks/use-session';
import { PipelineBar } from '../components/pipeline-bar';
import { RecentApplications } from '../components/recent-applications';

/** Nombre de candidatures listées dans « Activité récente ». */
const RECENT_LIMIT = 5;

// Constante de module : une nouvelle référence à chaque rendu changerait la clé de cache
// TanStack Query et relancerait la requête en boucle.
const RECENT_QUERY: ApplicationListQueryInput = { limit: RECENT_LIMIT, sort: 'updated_desc' };

/** Taux d'entretien (0–1 côté API) en pourcentage entier, tiret quand le dénominateur est vide. */
function formatRate(rate: number | null): string {
  return rate === null ? '—' : `${Math.round(rate * 100)} %`;
}

/**
 * Tableau de bord (`/dashboard`) : première page après la connexion. Elle ne porte aucune
 * donnée propre — uniquement les chiffres de `GET /applications/stats` et les dernières
 * candidatures mises à jour — et renvoie vers les écrans qui font le travail. Un tableau de
 * bord qui recalculerait ses propres compteurs finirait par afficher autre chose que la page
 * « Mes candidatures ».
 */
export function DashboardPage() {
  const navigate = useNavigate();
  const session = useSession();
  const stats = useApplicationStats();
  const recent = useApplications(RECENT_QUERY);

  const firstName = session.data?.firstName;

  let tiles: ReactNode;
  if (stats.isPending) {
    tiles = (
      <>
        <StatTileSkeleton />
        <StatTileSkeleton />
        <StatTileSkeleton />
        <StatTileSkeleton />
      </>
    );
  } else if (stats.isError) {
    tiles = null;
  } else {
    tiles = (
      <>
        <StatTile label="Candidatures" value={stats.data.total} icon={Briefcase} hint="Toutes périodes confondues" />
        <StatTile label="Envoyées cette semaine" value={stats.data.appliedThisWeek} icon={Send} hint="Depuis lundi" />
        <StatTile label="Entretiens" value={stats.data.byStatus.INTERVIEW} icon={Target} hint="En cours" />
        <StatTile
          label="Taux d'entretien"
          value={formatRate(stats.data.interviewRate)}
          icon={Percent}
          hint="Entretiens et offres sur candidatures traitées"
        />
      </>
    );
  }

  let recentContent: ReactNode;
  if (recent.isPending) {
    recentContent = (
      <div className="space-y-3" role="status" aria-busy="true">
        <span className="sr-only">Chargement de l'activité récente…</span>
        {Array.from({ length: 3 }, (_, index) => (
          <Skeleton key={index} className="h-12 w-full" />
        ))}
      </div>
    );
  } else if (recent.isError) {
    recentContent = (
      <ErrorState message="Impossible de charger vos candidatures." onRetry={() => void recent.refetch()} role="status" />
    );
  } else if (recent.data.items.length === 0) {
    recentContent = (
      <EmptyState
        icon={Send}
        title="Aucune candidature pour l'instant."
        description="Parcourez les offres et suivez celles qui vous intéressent : elles apparaîtront ici."
        action={{ label: 'Parcourir les offres', onClick: () => navigate('/jobs') }}
      />
    );
  } else {
    recentContent = <RecentApplications items={recent.data.items} />;
  }

  return (
    <div className="mx-auto max-w-6xl">
      <PageHeader
        title={firstName ? `Bonjour ${firstName}` : 'Tableau de bord'}
        description="Vos candidatures en cours et l'avancement de votre recherche."
        actions={
          <>
            <Button variant="outline" asChild>
              <Link to="/resume">
                <FileText aria-hidden />
                Mon CV
              </Link>
            </Button>
            <Button asChild>
              <Link to="/jobs">
                <Briefcase aria-hidden />
                Parcourir les offres
              </Link>
            </Button>
          </>
        }
      />

      <div className="space-y-6">
        {stats.isError ? (
          <ErrorState message="Impossible de charger vos statistiques." onRetry={() => void stats.refetch()} role="status" />
        ) : (
          <>
            <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">{tiles}</div>

            {/* Barre de répartition seulement quand il y a quelque chose à répartir : à zéro
                candidature, elle n'afficherait qu'un rail vide sous quatre tuiles à zéro. */}
            {!stats.isPending && stats.data.total > 0 && (
              <Card>
                <CardHeader>
                  <CardTitle className="text-base">Répartition par statut</CardTitle>
                </CardHeader>
                <CardContent>
                  <PipelineBar byStatus={stats.data.byStatus} total={stats.data.total} />
                </CardContent>
              </Card>
            )}
          </>
        )}

        <Card>
          <CardHeader className="flex-row items-center justify-between gap-4 space-y-0">
            <CardTitle className="text-base">Activité récente</CardTitle>
            <Button variant="ghost" size="sm" asChild>
              <Link to="/applications">Tout voir</Link>
            </Button>
          </CardHeader>
          <CardContent>{recentContent}</CardContent>
        </Card>
      </div>
    </div>
  );
}
