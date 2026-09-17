import type { ApplicationListQueryInput } from '@jobtrack/shared';
import { useMemo } from 'react';
import { PageHeader } from '@/components/shared/page-header';
import { ApplicationFormDialog } from '../components/application-form-dialog';
import { ApplicationSheet } from '../components/application-sheet';
import { ApplicationsBoard } from '../components/applications-board';
import { ApplicationsFilters } from '../components/applications-filters';
import { ApplicationsTable } from '../components/applications-table';
import { useApplications } from '../hooks/use-applications';
import { useApplicationsUrlState, writeApplicationsUrlState } from '../lib/url-state';

/**
 * « Mes candidatures » (spec §2/§7) : en-tête, filtres, puis la vue choisie
 * (`?vue=table` par défaut, `?vue=kanban`). Tout l'état est porté par l'URL
 * (`useApplicationsUrlState`) : un lien reste partageable et rechargeable.
 */
export function ApplicationsPage() {
  const [state, setState] = useApplicationsUrlState();

  const query = useMemo<ApplicationListQueryInput>(
    () => ({ tab: state.tab, q: state.q === '' ? undefined : state.q, page: state.page, sort: state.sort }),
    [state.tab, state.q, state.page, state.sort],
  );
  const applications = useApplications(query);

  const hasFilters = state.tab !== 'all' || state.q !== '';

  function handlePageChange(page: number): void {
    window.scrollTo({ top: 0 });
    setState({ page });
  }

  /**
   * Ouvrir ou refermer le panneau de détail ne touche pas à la pagination
   * (`resetPage: false`) : consulter une candidature depuis la page 3 de la
   * table doit laisser la table sur la page 3 en refermant.
   */
  function setApplicationId(applicationId: string | null): void {
    setState({ applicationId }, { resetPage: false });
  }

  return (
    <div className="mx-auto max-w-6xl">
      <PageHeader title="Mes candidatures" description="Chaque candidature, son statut, sa source et le CV utilisé." />

      <div className="space-y-6">
        <ApplicationsFilters
          tab={state.tab}
          q={state.q}
          view={state.view}
          sort={state.sort}
          onTabChange={(tab) => setState({ tab })}
          onQueryChange={(q) => setState({ q })}
          onViewChange={(view) => setState({ view })}
          onSortChange={(sort) => setState({ sort })}
          onAdd={() => setState({ adding: true })}
        />

        {state.view === 'table' ? (
          <ApplicationsTable
            data={applications.data}
            isPending={applications.isPending}
            isError={applications.isError}
            error={applications.error}
            hasFilters={hasFilters}
            onRetry={() => void applications.refetch()}
            onPageChange={handlePageChange}
            onOpen={setApplicationId}
            onAdd={() => setState({ adding: true })}
            onClearFilters={() => setState({ tab: 'all', q: '' })}
            hrefForPage={(page) => `?${writeApplicationsUrlState({ ...state, page }).toString()}`}
          />
        ) : (
          <ApplicationsBoard onOpen={setApplicationId} />
        )}

        {/* Panneau de détail piloté par `?candidature=<id>`, ouvert aussi bien
            depuis la table que depuis le Kanban ou le formulaire de création.
            Une suppression appelle le même `onClose`, qui retire le paramètre. */}
        <ApplicationSheet id={state.applicationId} onClose={() => setApplicationId(null)} />
      </div>

      <ApplicationFormDialog
        open={state.adding}
        onOpenChange={(open) => setState({ adding: open })}
        // Une candidature vient d'être créée : elle est en tête du tri par
        // défaut (mise à jour la plus récente), donc sur la première page.
        onCreated={() => setState({ page: 1 })}
        onOpenApplication={(applicationId) => setState({ applicationId, adding: false }, { resetPage: false })}
      />
    </div>
  );
}
