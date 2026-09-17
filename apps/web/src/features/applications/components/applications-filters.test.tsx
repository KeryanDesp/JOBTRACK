import type { ApplicationStatsDto } from '@jobtrack/shared';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { ApplicationsFilters } from './applications-filters';

const fetchApplicationStats = vi.hoisted(() => vi.fn());

beforeAll(() => {
  Element.prototype.scrollIntoView = vi.fn();
});

vi.mock('@/services/api/applications', () => ({
  fetchApplications: vi.fn(),
  fetchApplicationStats,
  fetchApplicationBoard: vi.fn(),
  fetchApplication: vi.fn(),
  createApplication: vi.fn(),
  updateApplication: vi.fn(),
  moveApplication: vi.fn(),
  deleteApplication: vi.fn(),
}));

afterEach(() => {
  fetchApplicationStats.mockReset();
  vi.useRealTimers();
});

const STATS: ApplicationStatsDto = {
  total: 4,
  byStatus: { TO_APPLY: 1, APPLIED: 2, INTERVIEW: 1, OFFER: 0, REJECTED: 0 },
  appliedThisWeek: 2,
  interviewRate: 0.5,
};

interface Props {
  tab: 'all' | 'to_apply' | 'applied' | 'interview' | 'offer' | 'rejected';
  q: string;
  view: 'table' | 'kanban';
  sort: 'updated_desc' | 'applied_desc' | 'company_asc';
  onTabChange: (tab: Props['tab']) => void;
  onQueryChange: (q: string) => void;
  onViewChange: (view: Props['view']) => void;
  onSortChange: (sort: Props['sort']) => void;
  onAdd: () => void;
}

function defaultProps(overrides: Partial<Props> = {}): Props {
  return {
    tab: 'all',
    q: '',
    view: 'table',
    sort: 'updated_desc',
    onTabChange: vi.fn(),
    onQueryChange: vi.fn(),
    onViewChange: vi.fn(),
    onSortChange: vi.fn(),
    onAdd: vi.fn(),
    ...overrides,
  };
}

function renderFilters(overrides: Partial<Props> = {}) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const props = defaultProps(overrides);
  const utils = render(
    <QueryClientProvider client={client}>
      <ApplicationsFilters {...props} />
    </QueryClientProvider>,
  );
  const rerenderWith = (next: Partial<Props>) => {
    const merged = { ...props, ...next };
    utils.rerender(
      <QueryClientProvider client={client}>
        <ApplicationsFilters {...merged} />
      </QueryClientProvider>,
    );
  };
  return { ...utils, props, rerenderWith };
}

describe('ApplicationsFilters — recherche temporisee', () => {
  it('n_appelle pas onQueryChange avant la fin des 300 ms', async () => {
    fetchApplicationStats.mockResolvedValue(STATS);
    const onQueryChange = vi.fn();
    renderFilters({ onQueryChange });

    fireEvent.change(screen.getByLabelText('Rechercher un poste ou une entreprise'), { target: { value: 'analyst' } });

    expect(onQueryChange).not.toHaveBeenCalled();
    await waitFor(() => expect(onQueryChange).toHaveBeenCalledWith('analyst'));
  });

  it('annule le minuteur en attente quand q change de l_exterieur avant son echeance', () => {
    fetchApplicationStats.mockResolvedValue(STATS);
    vi.useFakeTimers();
    const onQueryChange = vi.fn();
    const { rerenderWith } = renderFilters({ q: 'ia', onQueryChange });

    // L_utilisateur tape la suite d_un mot juste avant qu_« Effacer les filtres »
    // (ou une navigation vers un lien partage) ne remette `q` a l_exterieur.
    fireEvent.change(screen.getByLabelText('Rechercher un poste ou une entreprise'), { target: { value: 'iaxxx' } });
    vi.advanceTimersByTime(150);

    rerenderWith({ q: '' });
    vi.advanceTimersByTime(300);

    // Le minuteur pour « iaxxx » a ete annule par le changement externe : il
    // n_ecrit jamais cette valeur perimee dans l_URL a retardement.
    expect(onQueryChange).not.toHaveBeenCalledWith('iaxxx');
    expect(screen.getByLabelText('Rechercher un poste ou une entreprise')).toHaveValue('');
  });
});

describe('ApplicationsFilters — compteurs des onglets', () => {
  it('affiche un squelette par onglet tant que les stats ne sont pas connues, puis les comptes reels', async () => {
    let resolveStats: (value: ApplicationStatsDto) => void = () => {};
    fetchApplicationStats.mockImplementation(
      () =>
        new Promise<ApplicationStatsDto>((resolve) => {
          resolveStats = resolve;
        }),
    );
    renderFilters();

    const tab = screen.getByRole('tab', { name: 'Toutes' });
    expect(tab.querySelector('[data-slot="tab-count-skeleton"]')).not.toBeNull();

    resolveStats(STATS);
    const resolvedTab = await screen.findByRole('tab', { name: 'Toutes 4' });
    expect(resolvedTab.querySelector('[data-slot="tab-count-skeleton"]')).toBeNull();
  });
});

describe('ApplicationsFilters — bascule de vue', () => {
  it('porte aria-pressed sur le bouton de la vue active et appelle onViewChange au clic', async () => {
    fetchApplicationStats.mockResolvedValue(STATS);
    const user = userEvent.setup();
    const onViewChange = vi.fn();
    renderFilters({ view: 'table', onViewChange });

    expect(screen.getByRole('button', { name: 'Vue table' })).toHaveAttribute('aria-pressed', 'true');
    expect(screen.getByRole('button', { name: 'Vue Kanban' })).toHaveAttribute('aria-pressed', 'false');

    await user.click(screen.getByRole('button', { name: 'Vue Kanban' }));
    expect(onViewChange).toHaveBeenCalledWith('kanban');
  });
});

describe('ApplicationsFilters — tri', () => {
  it('affiche le libelle du tri courant et appelle onSortChange sur un nouveau choix', async () => {
    fetchApplicationStats.mockResolvedValue(STATS);
    const user = userEvent.setup();
    const onSortChange = vi.fn();
    renderFilters({ sort: 'updated_desc', onSortChange });

    expect(screen.getByRole('combobox', { name: 'Trier par' })).toHaveTextContent('Dernière mise à jour');

    await user.click(screen.getByRole('combobox', { name: 'Trier par' }));
    await user.click(await screen.findByRole('option', { name: 'Entreprise A→Z' }));

    expect(onSortChange).toHaveBeenCalledWith('company_asc');
  });
});
