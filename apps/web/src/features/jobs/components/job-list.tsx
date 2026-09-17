import type { JobListResponseDto, JobSearchQuery } from '@jobtrack/shared';
import { AlertTriangle, SearchX } from 'lucide-react';
import type { MouseEvent } from 'react';
import { EmptyState } from '@/components/shared/empty-state';
import { ErrorState } from '@/components/shared/error-state';
import { Alert, AlertDescription } from '@/components/ui/alert';
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
import { ApiError } from '@/services/api/client';
import { writeJobSearchQuery } from '../lib/search-params';
import { JobCard } from './job-card';

interface JobListProps {
  data: JobListResponseDto | undefined;
  /** Critères courants (spec §8) : sert uniquement à construire les `href` réels de la pagination. */
  query: JobSearchQuery;
  isPending: boolean;
  isError: boolean;
  /** Erreur brute de la requête (`useQuery().error`) : convertie en message français par `refetchErrorMessage`. */
  error: unknown;
  isPlaceholderData: boolean;
  onRetry: () => void;
  onPageChange: (page: number) => void;
  /** `undefined` quand aucun filtre n'est actif : rien à réinitialiser, le bouton disparaît. */
  onResetFilters: (() => void) | undefined;
}

/**
 * Message d'un échec de requête (chargement initial ou réactualisation en
 * arrière-plan, ex. « Actualiser » heurtant la limite de débit) : le code
 * `VALIDATION_ERROR` reçoit un message dédié (les filtres sont en cause, pas
 * le serveur), les autres codes conservent le message déjà français renvoyé
 * par l'API (ex. `RATE_LIMITED`), et toute erreur qui n'est pas une `ApiError`
 * (panne réseau déjà traduite par `apiRequest`, ou cas inattendu) retombe sur
 * un message générique.
 */
function refetchErrorMessage(error: unknown): string {
  if (error instanceof ApiError) {
    if (error.code === 'VALIDATION_ERROR') return 'Recherche invalide : vérifiez les filtres.';
    return error.message;
  }
  return 'Impossible de charger les offres.';
}

/** `true` seulement pour un clic gauche sans modificateur : les autres doivent laisser le navigateur agir (nouvel onglet, etc.). */
function isPlainLeftClick(event: MouseEvent): boolean {
  return event.button === 0 && !event.metaKey && !event.ctrlKey && !event.shiftKey && !event.altKey;
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
export function JobList({
  data,
  query,
  isPending,
  isError,
  error,
  isPlaceholderData,
  onRetry,
  onPageChange,
  onResetFilters,
}: JobListProps) {
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

  // Une réactualisation en arrière-plan (ex. « Actualiser » heurtant la limite de
  // débit) ne doit jamais effacer une liste déjà affichée : `ErrorState` (pleine
  // page) reste réservé au tout premier chargement, quand rien n'est encore
  // affichable. Sinon, la liste précédente reste visible sous une alerte inline.
  if (isError && !data) {
    return <ErrorState message={refetchErrorMessage(error)} onRetry={onRetry} />;
  }

  const errorAlert = isError ? (
    <Alert variant="destructive" className="mb-4">
      <AlertTriangle />
      <AlertDescription>{refetchErrorMessage(error)}</AlertDescription>
    </Alert>
  ) : null;

  if (!data || data.items.length === 0) {
    return (
      <div>
        {errorAlert}
        <EmptyState
          icon={SearchX}
          title="Aucune offre ne correspond."
          description="Élargissez le rayon ou retirez un filtre."
          action={onResetFilters ? { label: 'Réinitialiser les filtres', onClick: onResetFilters } : undefined}
        />
      </div>
    );
  }

  const totalPages = Math.max(1, Math.ceil(data.total / data.pageSize));
  const pages = pageNumbers(data.page, totalPages);
  const isFirstPage = data.page <= 1;
  const isLastPage = data.page >= totalPages;

  /** `href` réel pour une page donnée (spec §8) : le clic normal garde le SPA, cmd/ctrl/molette ouvre un nouvel onglet. */
  function hrefForPage(page: number): string {
    return `?${writeJobSearchQuery({ ...query, page }).toString()}`;
  }

  return (
    <div className={isPlaceholderData ? 'opacity-60 transition-opacity' : 'transition-opacity'}>
      {errorAlert}
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
                href={isFirstPage ? undefined : hrefForPage(data.page - 1)}
                aria-disabled={isFirstPage}
                className={isFirstPage ? 'pointer-events-none opacity-50' : undefined}
                onClick={(event) => {
                  if (!isPlainLeftClick(event)) return;
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
                    href={hrefForPage(page)}
                    isActive={page === data.page}
                    onClick={(event) => {
                      if (!isPlainLeftClick(event)) return;
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
                href={isLastPage ? undefined : hrefForPage(data.page + 1)}
                aria-disabled={isLastPage}
                className={isLastPage ? 'pointer-events-none opacity-50' : undefined}
                onClick={(event) => {
                  if (!isPlainLeftClick(event)) return;
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
