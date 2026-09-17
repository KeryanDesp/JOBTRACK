import type { ApplicationDto, ApplicationListResponseDto, ApplicationStatus } from '@jobtrack/shared';
import { ExternalLink, Inbox, SearchX } from 'lucide-react';
import type { MouseEvent } from 'react';
import { Link } from 'react-router-dom';
import { EmptyState } from '@/components/shared/empty-state';
import { ErrorState } from '@/components/shared/error-state';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
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
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { isHttpUrl } from '@/features/jobs/lib/format';
import { ApiError } from '@/services/api/client';
import { useUpdateApplication } from '../hooks/use-applications';
import { EMPTY_VALUE, formatApplicationDate, resumeLabel, sourceLabel } from '../lib/format';
import { AddApplicationButton } from './add-application-button';
import { ApplicationStatusSelect } from './application-status-select';

interface ApplicationsTableProps {
  data: ApplicationListResponseDto | undefined;
  isPending: boolean;
  isError: boolean;
  /** Erreur brute de la requête (`useQuery().error`), convertie en message français ici. */
  error: unknown;
  /** Un onglet ou une recherche est actif : change l'état vide et propose « Effacer les filtres ». */
  hasFilters: boolean;
  onRetry: () => void;
  onPageChange: (page: number) => void;
  onOpen: (id: string) => void;
  onAdd: () => void;
  onClearFilters: () => void;
  /** `href` réel d'une page (spec §7) : le clic gauche reste en SPA, cmd/ctrl ouvre un onglet. */
  hrefForPage: (page: number) => string;
}

function listErrorMessage(error: unknown): string {
  return error instanceof ApiError ? error.message : 'Impossible de charger les candidatures.';
}

/** `true` seulement pour un clic gauche sans modificateur (même règle que `JobList`). */
function isPlainLeftClick(event: MouseEvent): boolean {
  return event.button === 0 && !event.metaKey && !event.ctrlKey && !event.shiftKey && !event.altKey;
}

type PaginationEntry = number | 'ellipsis';

/**
 * Fenêtre de pagination (spec §7) : toujours la première et la dernière
 * page, plus les deux pages de chaque côté de la page courante — jamais
 * chacune des pages une à une, illisible dès que `totalPages` dépasse une
 * dizaine. Les trous entre deux pages retenues non consécutives deviennent
 * une seule `PaginationEllipsis`.
 */
function paginationRange(current: number, totalPages: number): PaginationEntry[] {
  const kept = new Set<number>([1, totalPages]);
  for (let page = current - 2; page <= current + 2; page += 1) {
    if (page >= 1 && page <= totalPages) kept.add(page);
  }

  const sorted = Array.from(kept).sort((a, b) => a - b);
  const entries: PaginationEntry[] = [];
  let previous: number | undefined;
  for (const page of sorted) {
    if (previous !== undefined && page - previous > 1) entries.push('ellipsis');
    entries.push(page);
    previous = page;
  }
  return entries;
}

/** Cellule « CV utilisé » : lien vers le CV adapté quand il existe encore, libellé simple sinon. */
function ResumeCell({ application }: { application: ApplicationDto }) {
  const label = resumeLabel(application);
  if (application.resume) {
    return (
      <Link to={`/resume/${application.resume.id}`} className="text-primary underline-offset-4 hover:underline">
        {label}
      </Link>
    );
  }
  return <span className={label === EMPTY_VALUE ? 'text-muted-foreground' : undefined}>{label}</span>;
}

/**
 * Cellule « Source » : libellé français, plus un lien externe quand la
 * candidature porte une URL `http(s)` (spec §5 — jamais un autre schéma, et
 * toujours `rel="noopener noreferrer"`).
 */
/**
 * Sous `lg`, la table déborde de son conteneur (spec §7, revue visuelle
 * tranche 6) : le libellé texte disparaît alors, seule l'icône du lien
 * externe reste visible — `aria-label` porte le nom accessible complet dans
 * les deux cas, la disparition du texte n'est que visuelle.
 */
function SourceCell({ application }: { application: ApplicationDto }) {
  const label = sourceLabel(application);
  if (!isHttpUrl(application.sourceUrl)) return <span>{label}</span>;

  return (
    <a
      href={application.sourceUrl}
      target="_blank"
      rel="noopener noreferrer"
      aria-label={`Ouvrir l'offre ${application.jobTitle} sur ${label}`}
      className="text-muted-foreground hover:text-foreground inline-flex items-center gap-1.5"
    >
      <span className="hidden lg:inline">{label}</span>
      <ExternalLink aria-hidden="true" className="size-3.5" />
    </a>
  );
}

/** État vide selon qu'un filtre est actif (spec §7) : deux messages, deux actions différentes. */
function ApplicationsEmptyState({
  hasFilters,
  onAdd,
  onClearFilters,
}: {
  hasFilters: boolean;
  onAdd: () => void;
  onClearFilters: () => void;
}) {
  if (hasFilters) {
    return (
      <EmptyState
        icon={SearchX}
        title="Aucune candidature ne correspond."
        description="Changez d'onglet ou modifiez votre recherche."
        action={{ label: 'Effacer les filtres', onClick: onClearFilters }}
      />
    );
  }

  return (
    <div className="space-y-4">
      <EmptyState icon={Inbox} title="Aucune candidature." description="Suivez une offre ou ajoutez une candidature." />
      <div className="flex flex-wrap justify-center gap-2">
        <Button asChild variant="outline">
          <Link to="/jobs">Voir les offres</Link>
        </Button>
        <AddApplicationButton onClick={onAdd} />
      </div>
    </div>
  );
}

/**
 * Vue table des candidatures (spec §2/§7) : colonnes Poste / Entreprise /
 * Date / CV utilisé / Source / Statut, sélecteur de statut inline (optimiste
 * via `useUpdateApplication`), ouverture de la fiche par ligne
 * (`?candidature=<id>`) et pagination.
 *
 * Sous `md`, la table sémantique laisse place à une liste de cartes portant
 * exactement les mêmes données (une table à six colonnes n'est pas lisible
 * sur un téléphone) : les deux sont rendues, une seule est affichée — celle
 * qui ne l'est pas est retirée de l'arbre d'accessibilité par `display: none`.
 */
export function ApplicationsTable({
  data,
  isPending,
  isError,
  error,
  hasFilters,
  onRetry,
  onPageChange,
  onOpen,
  onAdd,
  onClearFilters,
  hrefForPage,
}: ApplicationsTableProps) {
  const updateApplication = useUpdateApplication();

  function handleStatusChange(application: ApplicationDto, status: ApplicationStatus): void {
    if (status === application.status) return;
    updateApplication.mutate({ id: application.id, input: { status } });
  }

  if (isPending) {
    return (
      <div className="space-y-2" role="status" aria-busy="true">
        <span className="sr-only">Chargement des candidatures…</span>
        {Array.from({ length: 5 }, (_, index) => (
          <Skeleton key={index} className="h-14 w-full" />
        ))}
      </div>
    );
  }

  // Une erreur alors qu'aucune donnée n'est affichable bloque toute la vue ;
  // elle ne doit jamais effacer une liste déjà à l'écran (même principe que `JobList`).
  if (isError && !data) {
    return <ErrorState message={listErrorMessage(error)} onRetry={onRetry} />;
  }

  if (!data || data.items.length === 0) {
    return <ApplicationsEmptyState hasFilters={hasFilters} onAdd={onAdd} onClearFilters={onClearFilters} />;
  }

  const items = data.items;
  const totalPages = Math.max(1, Math.ceil(data.total / data.limit));
  const isFirstPage = data.page <= 1;
  const isLastPage = data.page >= totalPages;

  return (
    <div className="space-y-6">
      {/* `[&_[data-slot=table-cell]]:px-1.5`/`table-head` : marge horizontale
          réduite par cellule (spec §7, revue visuelle tranche 6) — la table
          débordait de ~41 px à 1024 px (colonne Actions rognée) ; combiné au
          sélecteur de statut resserré (`w-36` ci-dessous) et à la disparition
          du libellé de la colonne Source sous `lg`, elle tient désormais dans
          les ~720 px disponibles à côté du menu latéral. */}
      <div className="hidden md:block [&_[data-slot=table-cell]]:px-1.5 [&_[data-slot=table-head]]:px-1.5">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Poste</TableHead>
              <TableHead>Entreprise</TableHead>
              <TableHead>Date</TableHead>
              <TableHead>CV utilisé</TableHead>
              <TableHead>Source</TableHead>
              <TableHead>Statut</TableHead>
              <TableHead>
                <span className="sr-only">Actions</span>
              </TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {items.map((application) => (
              <TableRow key={application.id}>
                <TableCell className="max-w-[12rem] font-medium">
                  <button
                    type="button"
                    onClick={() => onOpen(application.id)}
                    title={application.jobTitle}
                    className="block max-w-full truncate rounded-sm text-left underline-offset-4 hover:underline focus-visible:ring-[3px] focus-visible:ring-ring/50 focus-visible:outline-none"
                  >
                    {application.jobTitle}
                  </button>
                </TableCell>
                <TableCell className="text-muted-foreground">{application.company ?? EMPTY_VALUE}</TableCell>
                <TableCell className="text-muted-foreground tabular-nums">{formatApplicationDate(application.appliedAt)}</TableCell>
                <TableCell>
                  <ResumeCell application={application} />
                </TableCell>
                <TableCell className="text-muted-foreground">
                  <SourceCell application={application} />
                </TableCell>
                <TableCell>
                  <ApplicationStatusSelect
                    value={application.status}
                    size="sm"
                    ariaLabel={`Statut de ${application.jobTitle}`}
                    onChange={(status) => handleStatusChange(application, status)}
                    className="w-36 min-w-0"
                  />
                </TableCell>
                <TableCell className="text-right">
                  <Button type="button" variant="ghost" size="sm" onClick={() => onOpen(application.id)}>
                    Ouvrir
                    <span className="sr-only"> {application.jobTitle}</span>
                  </Button>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>

      <ul className="space-y-3 md:hidden">
        {items.map((application) => (
          <li key={application.id}>
            <Card>
              <CardContent className="space-y-3">
                <div className="min-w-0">
                  <button
                    type="button"
                    onClick={() => onOpen(application.id)}
                    className="rounded-sm text-left font-medium underline-offset-4 hover:underline focus-visible:ring-[3px] focus-visible:ring-ring/50 focus-visible:outline-none"
                  >
                    {application.jobTitle}
                  </button>
                  <p className="text-muted-foreground text-sm">{application.company ?? EMPTY_VALUE}</p>
                </div>

                <dl className="text-muted-foreground grid grid-cols-2 gap-x-4 gap-y-1 text-sm">
                  <div>
                    <dt className="sr-only">Date</dt>
                    <dd className="tabular-nums">{formatApplicationDate(application.appliedAt)}</dd>
                  </div>
                  <div>
                    <dt className="sr-only">Source</dt>
                    <dd>
                      <SourceCell application={application} />
                    </dd>
                  </div>
                  <div className="col-span-2">
                    <dt className="sr-only">CV utilisé</dt>
                    <dd>
                      <ResumeCell application={application} />
                    </dd>
                  </div>
                </dl>

                <div className="flex items-center gap-2">
                  <ApplicationStatusSelect
                    value={application.status}
                    size="sm"
                    ariaLabel={`Statut de ${application.jobTitle}`}
                    onChange={(status) => handleStatusChange(application, status)}
                  />
                  <Button type="button" variant="ghost" size="sm" className="ml-auto" onClick={() => onOpen(application.id)}>
                    Ouvrir
                    <span className="sr-only"> {application.jobTitle}</span>
                  </Button>
                </div>
              </CardContent>
            </Card>
          </li>
        ))}
      </ul>

      {totalPages > 1 && (
        <Pagination>
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

            {paginationRange(data.page, totalPages).map((entry, index) =>
              entry === 'ellipsis' ? (
                <PaginationItem key={`ellipsis-${index}`}>
                  <PaginationEllipsis />
                </PaginationItem>
              ) : (
                <PaginationItem key={entry}>
                  <PaginationLink
                    href={hrefForPage(entry)}
                    isActive={entry === data.page}
                    onClick={(event) => {
                      if (!isPlainLeftClick(event)) return;
                      event.preventDefault();
                      onPageChange(entry);
                    }}
                  >
                    {entry}
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
