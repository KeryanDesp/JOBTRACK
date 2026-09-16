import type { JobListResponseDto } from '@jobtrack/shared';
import { SearchX } from 'lucide-react';
import { EmptyState } from '@/components/shared/empty-state';
import { ErrorState } from '@/components/shared/error-state';
import {
  Pagination,
  PaginationContent,
  PaginationEllipsis,
  PaginationItem,
  PaginationLink,
  PaginationNext,
  PaginationPrevious,
} from '@/components/ui/pagination';
import { Skeleton } from '@/components/ui/skeleton';
import { JobCard } from './job-card';

interface JobListProps {
  data: JobListResponseDto | undefined;
  isPending: boolean;
  isError: boolean;
  isPlaceholderData: boolean;
  onRetry: () => void;
  onPageChange: (page: number) => void;
  /** `undefined` quand aucun filtre n'est actif : rien à réinitialiser, le bouton disparaît. */
  onResetFilters: (() => void) | undefined;
}

/**
 * Numéros de page à afficher (≤ 7, avec ellipses) : toujours la première, la
 * dernière, et jusqu'à une page de part et d'autre de la page courante. Un
 * seul numéro manquant entre deux pages conservées (écart de 2) est affiché
 * directement plutôt que remplacé par une ellipse, qui n'a de sens que pour
 * représenter plusieurs pages sautées à la fois.
 */
function pageNumbers(current: number, total: number): (number | 'ellipsis')[] {
  if (total <= 7) return Array.from({ length: total }, (_, index) => index + 1);

  const kept = new Set([1, 2, total - 1, total, current - 1, current, current + 1].filter((page) => page >= 1 && page <= total));
  const sorted = [...kept].sort((a, b) => a - b);

  const result: (number | 'ellipsis')[] = [];
  let previous = 0;
  for (const page of sorted) {
    if (previous !== 0) {
      const gap = page - previous;
      if (gap === 2) result.push(previous + 1);
      else if (gap > 2) result.push('ellipsis');
    }
    result.push(page);
    previous = page;
  }
  return result;
}

/** Liste des résultats (spec §7/§8) : squelettes, erreur, vide, ou cartes + pagination. */
export function JobList({ data, isPending, isError, isPlaceholderData, onRetry, onPageChange, onResetFilters }: JobListProps) {
  if (isPending) {
    return (
      <div className="space-y-4" role="status" aria-busy="true">
        <span className="sr-only">Recherche en cours…</span>
        {Array.from({ length: 5 }, (_, index) => (
          <Skeleton key={index} className="h-32 w-full" />
        ))}
      </div>
    );
  }

  if (isError) {
    return <ErrorState message="Impossible de charger les offres. Réessayez." onRetry={onRetry} />;
  }

  if (!data || data.items.length === 0) {
    return (
      <EmptyState
        icon={SearchX}
        title="Aucune offre ne correspond."
        description="Élargissez le rayon ou retirez un filtre."
        action={onResetFilters ? { label: 'Réinitialiser les filtres', onClick: onResetFilters } : undefined}
      />
    );
  }

  const totalPages = Math.max(1, Math.ceil(data.total / data.pageSize));
  const pages = pageNumbers(data.page, totalPages);
  const isFirstPage = data.page <= 1;
  const isLastPage = data.page >= totalPages;

  return (
    <div className={isPlaceholderData ? 'opacity-60 transition-opacity' : 'transition-opacity'}>
      <div className="space-y-4">
        {data.items.map((job) => (
          <JobCard key={job.id} job={job} />
        ))}
      </div>

      {totalPages > 1 && (
        <Pagination className="mt-6">
          <PaginationContent>
            <PaginationItem>
              <PaginationPrevious
                href="#"
                aria-disabled={isFirstPage}
                className={isFirstPage ? 'pointer-events-none opacity-50' : undefined}
                onClick={(event) => {
                  event.preventDefault();
                  if (!isFirstPage) onPageChange(data.page - 1);
                }}
              />
            </PaginationItem>

            {pages.map((page, index) =>
              page === 'ellipsis' ? (
                <PaginationItem key={`ellipsis-${index}`}>
                  <PaginationEllipsis />
                </PaginationItem>
              ) : (
                <PaginationItem key={page}>
                  <PaginationLink
                    href="#"
                    isActive={page === data.page}
                    onClick={(event) => {
                      event.preventDefault();
                      onPageChange(page);
                    }}
                  >
                    {page}
                  </PaginationLink>
                </PaginationItem>
              ),
            )}

            <PaginationItem>
              <PaginationNext
                href="#"
                aria-disabled={isLastPage}
                className={isLastPage ? 'pointer-events-none opacity-50' : undefined}
                onClick={(event) => {
                  event.preventDefault();
                  if (!isLastPage) onPageChange(data.page + 1);
                }}
              />
            </PaginationItem>
          </PaginationContent>
        </Pagination>
      )}
    </div>
  );
}
