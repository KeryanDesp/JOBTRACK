import type { ApplicationListQueryInput } from '@jobtrack/shared';
import { useMemo } from 'react';
import { PageHeader } from '@/components/shared/page-header';
import { ApplicationFormDialog } from '../components/application-form-dialog';
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
    () => ({ tab: state.tab, q: state.q === '' ? undefined : state.q, page: state.page }),
    [state.tab, state.q, state.page],
  );
  const applications = useApplications(query);

  const hasFilters = state.tab !== 'all' || state.q !== '';

  function handlePageChange(page: number): void {
    window.scrollTo({ top: 0 });
    setState({ page });
  }

  return (
    <div className="mx-auto max-w-6xl">
      <PageHeader title="Mes candidatures" description="Chaque candidature, son statut, sa source et le CV utilisé." />

      <div className="space-y-6">
        <ApplicationsFilters
          tab={state.tab}
          q={state.q}
          view={state.view}
          onTabChange={(tab) => setState({ tab })}
          onQueryChange={(q) => setState({ q })}
          onViewChange={(view) => setState({ view })}
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
            onOpen={(id) => setState({ applicationId: id })}
            onAdd={() => setState({ adding: true })}
            onClearFilters={() => setState({ tab: 'all', q: '' })}
            hrefForPage={(page) => `?${writeApplicationsUrlState({ ...state, page }).toString()}`}
          />
        ) : (
          // Emplacement du Kanban — remplacé par ApplicationsBoard (tâche 6).
          <div data-slot="applications-board-slot" className="text-muted-foreground py-16 text-center text-sm">
            Vue Kanban
          </div>
        )}

        {/* Emplacement du panneau de détail `?candidature=<id>` — remplacé par
            ApplicationSheet (tâche 6). L'identifiant est déjà lu dans l'URL
            (`state.applicationId`) et écrit par la table. */}
      </div>

      <ApplicationFormDialog
        open={state.adding}
        onOpenChange={(open) => setState({ adding: open })}
        // Une candidature vient d'être créée : elle est en tête du tri par
        // défaut (mise à jour la plus récente), donc sur la première page.
        onCreated={() => setState({ page: 1 })}
        onOpenApplication={(applicationId) => setState({ applicationId, adding: false })}
      />
    </div>
  );
}
