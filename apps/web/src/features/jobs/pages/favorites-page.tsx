import { Heart } from 'lucide-react';
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
  const jobs = savedJobsQuery.data;

  return (
    <TooltipProvider>
      <div className="mx-auto max-w-5xl">
        <PageHeader title="Favoris" description={subtitleFor(jobs?.length)} />

        {savedJobsQuery.isPending && (
          <div className="space-y-4" role="status" aria-busy="true">
            <span className="sr-only">Chargement des favoris…</span>
            {Array.from({ length: 3 }, (_, index) => (
              <Skeleton key={index} className="h-32 w-full" />
            ))}
          </div>
        )}

        {savedJobsQuery.isError && (
          <ErrorState message="Impossible de charger vos favoris. Réessayez." onRetry={() => void savedJobsQuery.refetch()} />
        )}

        {jobs &&
          (jobs.length === 0 ? (
            <EmptyState
              icon={Heart}
              title="Aucune offre sauvegardée."
              description="Parcourez les offres pour en sauvegarder."
              action={{ label: 'Parcourir les offres', onClick: () => navigate('/jobs') }}
            />
          ) : (
            <div className="space-y-4">
              {jobs.map((job) => (
                <JobCard key={job.id} job={job} />
              ))}
            </div>
          ))}
      </div>
    </TooltipProvider>
  );
}
