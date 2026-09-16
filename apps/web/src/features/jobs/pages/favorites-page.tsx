import { Heart } from 'lucide-react';
import type { ReactNode } from 'react';
import { useNavigate } from 'react-router-dom';
import { EmptyState } from '@/components/shared/empty-state';
import { ErrorState } from '@/components/shared/error-state';
import { PageHeader } from '@/components/shared/page-header';
import { Skeleton } from '@/components/ui/skeleton';
import { TooltipProvider } from '@/components/ui/tooltip';
import { JobCard } from '../components/job-card';
import { useSavedJobs } from '../hooks/use-jobs';

const DEFAULT_DESCRIPTION = 'Les offres que vous avez sauvegardées.';

/** Sous-titre (spec tâche 9) : nombre d'offres une fois la liste chargée et non vide, description par défaut sinon. */
function subtitleFor(count: number | undefined): string {
  if (!count) return DEFAULT_DESCRIPTION;
  return `${count} offre${count > 1 ? 's' : ''} sauvegardée${count > 1 ? 's' : ''}.`;
}

/**
 * Favoris (`/favorites`, spec §2/§7, tâche 9) : squelettes pendant le
 * chargement, erreur avec réessai, vide avec un lien vers `/jobs`, ou liste
 * de `JobCard` — le retrait depuis une carte (`SaveJobButton`) met déjà à
 * jour ce cache de façon optimiste via `useSaveJob` (non dupliqué ici).
 */
export function FavoritesPage() {
  const navigate = useNavigate();
  const savedJobsQuery = useSavedJobs();

  // Chaîne `if`/`else if` plutôt que trois blocs conditionnels indépendants (revue
  // f9bf90c, point 11) : un seul état de `savedJobsQuery` peut être vrai à la fois
  // (pending/erreur/données sont mutuellement exclusifs côté TanStack Query), mais
  // cette écriture le rend visible dans le code plutôt que de le supposer implicite.
  let content: ReactNode;
  if (savedJobsQuery.isPending) {
    content = (
      <div className="space-y-4" role="status" aria-busy="true">
        <span className="sr-only">Chargement des favoris…</span>
        {Array.from({ length: 3 }, (_, index) => (
          <Skeleton key={index} className="h-32 w-full" />
        ))}
      </div>
    );
  } else if (savedJobsQuery.isError) {
    content = <ErrorState message="Impossible de charger vos favoris. Réessayez." onRetry={() => void savedJobsQuery.refetch()} />;
  } else if (savedJobsQuery.data.length === 0) {
    content = (
      <EmptyState
        icon={Heart}
        title="Aucune offre sauvegardée."
        description="Parcourez les offres pour en sauvegarder."
        action={{ label: 'Parcourir les offres', onClick: () => navigate('/jobs') }}
      />
    );
  } else {
    content = (
      <div className="space-y-4">
        {savedJobsQuery.data.map((job) => (
          <JobCard key={job.id} job={job} />
        ))}
      </div>
    );
  }

  return (
    <TooltipProvider>
      <div className="mx-auto max-w-5xl">
        <PageHeader title="Favoris" description={subtitleFor(savedJobsQuery.data?.length)} />
        {content}
      </div>
    </TooltipProvider>
  );
}
