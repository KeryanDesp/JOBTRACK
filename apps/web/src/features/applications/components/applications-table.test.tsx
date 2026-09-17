import type { ApplicationDto, ApplicationListResponseDto } from '@jobtrack/shared';
import { APPLICATION_STATUS_LABELS } from '@jobtrack/shared';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { ReactElement } from 'react';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { ApiError } from '@/services/api/client';
import { ApplicationsTable } from './applications-table';

const updateApplicationApi = vi.hoisted(() => vi.fn());

vi.mock('@/services/api/applications', () => ({
  fetchApplications: vi.fn(),
  fetchApplicationStats: vi.fn(),
  fetchApplicationBoard: vi.fn(),
  fetchApplication: vi.fn(),
  createApplication: vi.fn(),
  updateApplication: updateApplicationApi,
  moveApplication: vi.fn(),
  deleteApplication: vi.fn(),
}));

beforeAll(() => {
  Element.prototype.scrollIntoView = vi.fn();
});

afterEach(() => {
  updateApplicationApi.mockReset();
});

function makeApplication(overrides: Partial<ApplicationDto> = {}): ApplicationDto {
  return {
    id: 'app_1',
    jobId: null,
    status: 'APPLIED',
    position: 0,
    jobTitle: 'Business Analyst',
    company: 'Societe Generale',
    locationLabel: 'Paris',
    salaryLabel: null,
    contractLabel: null,
    source: 'LINKEDIN',
    sourceUrl: null,
    appliedAt: '2026-09-15',
    usedBaseResume: false,
    resumeId: null,
    coverLetterId: null,
    notes: null,
    createdAt: '2026-09-15T08:00:00.000Z',
    updatedAt: '2026-09-15T08:00:00.000Z',
    job: null,
    resume: null,
    coverLetter: null,
    ...overrides,
  };
}

function makeList(items: ApplicationDto[], overrides: Partial<ApplicationListResponseDto> = {}): ApplicationListResponseDto {
  return { items, page: 1, limit: 20, total: items.length, ...overrides };
}

interface RenderOptions {
  data?: ApplicationListResponseDto;
  isPending?: boolean;
  isError?: boolean;
  error?: unknown;
  hasFilters?: boolean;
  onOpen?: (id: string) => void;
  onAdd?: () => void;
  onClearFilters?: () => void;
  onRetry?: () => void;
}

function renderTable(options: RenderOptions = {}) {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  const element: ReactElement = (
    <ApplicationsTable
      data={options.data}
      isPending={options.isPending ?? false}
      isError={options.isError ?? false}
      error={options.error}
      hasFilters={options.hasFilters ?? false}
      onRetry={options.onRetry ?? vi.fn()}
      onPageChange={vi.fn()}
      onOpen={options.onOpen ?? vi.fn()}
      onAdd={options.onAdd ?? vi.fn()}
      onClearFilters={options.onClearFilters ?? vi.fn()}
      hrefForPage={(page) => `?page=${page}`}
    />
  );

  return render(
    <MemoryRouter>
      <QueryClientProvider client={queryClient}>{element}</QueryClientProvider>
    </MemoryRouter>,
  );
}

/** La table semantique (md+) ; sous md une liste de cartes porte les memes donnees. */
function table(): HTMLElement {
  return screen.getByRole('table');
}

describe('ApplicationsTable', () => {
  it('affiche une ligne par candidature avec poste, entreprise, date et source', () => {
    renderTable({
      data: makeList([makeApplication(), makeApplication({ id: 'app_2', jobTitle: 'Data Analyst', company: 'Orange' })]),
    });

    const rows = within(table()).getAllByRole('row');
    // Une ligne d'en-tete plus une ligne par candidature.
    expect(rows).toHaveLength(3);

    const firstRow = rows[1];
    expect(firstRow).toBeDefined();
    const cells = within(firstRow as HTMLElement).getAllByRole('cell');
    expect(cells.map((cell) => cell.textContent)).toEqual([
      'Business Analyst',
      'Societe Generale',
      '15 sept. 2026',
      '—',
      'LinkedIn',
      'Candidature envoyée',
      'Ouvrir Business Analyst',
    ]);
  });

  it('affiche le tiret pour une date, une entreprise et un CV absents', () => {
    renderTable({ data: makeList([makeApplication({ appliedAt: null, company: null })]) });

    expect(within(table()).getAllByText('—')).toHaveLength(3);
  });

  it('lie le CV adapte a sa page et nomme le CV principal', () => {
    renderTable({
      data: makeList([
        makeApplication({ resumeId: 'r1', resume: { id: 'r1', title: 'CV Business Analyst', currentVersion: 2 } }),
        makeApplication({ id: 'app_2', jobTitle: 'Data Analyst', usedBaseResume: true }),
      ]),
    });

    expect(within(table()).getByRole('link', { name: 'CV Business Analyst' })).toHaveAttribute('href', '/resume/r1');
    expect(within(table()).getByText('CV principal')).toBeInTheDocument();
  });

  it('ouvre le lien de la source dans un nouvel onglet, sans fuite de referent', () => {
    renderTable({ data: makeList([makeApplication({ sourceUrl: 'https://exemple.fr/offre/1' })]) });

    const link = within(table()).getByRole('link', { name: /Ouvrir l'offre Business Analyst sur LinkedIn/ });
    expect(link).toHaveAttribute('href', 'https://exemple.fr/offre/1');
    expect(link).toHaveAttribute('target', '_blank');
    expect(link).toHaveAttribute('rel', 'noopener noreferrer');
  });

  it('n_affiche aucun lien externe pour une URL qui n_est pas http(s)', () => {
    renderTable({ data: makeList([makeApplication({ sourceUrl: 'javascript:alert(1)' })]) });

    expect(within(table()).queryByRole('link', { name: /Ouvrir l'offre/ })).not.toBeInTheDocument();
  });

  it('ouvre la fiche depuis le titre comme depuis le bouton Ouvrir', async () => {
    const user = userEvent.setup();
    const onOpen = vi.fn();
    renderTable({ data: makeList([makeApplication()]), onOpen });

    await user.click(within(table()).getByRole('button', { name: 'Business Analyst' }));
    expect(onOpen).toHaveBeenCalledWith('app_1');

    await user.click(within(table()).getByRole('button', { name: 'Ouvrir Business Analyst' }));
    expect(onOpen).toHaveBeenCalledTimes(2);
  });

  it('change le statut en ligne et envoie la modification au serveur', async () => {
    const user = userEvent.setup();
    updateApplicationApi.mockResolvedValue(makeApplication({ status: 'INTERVIEW' }));
    renderTable({ data: makeList([makeApplication()]) });

    await user.click(within(table()).getByRole('combobox', { name: 'Statut de Business Analyst' }));
    await user.click(await screen.findByRole('option', { name: APPLICATION_STATUS_LABELS.INTERVIEW }));

    await waitFor(() => expect(updateApplicationApi).toHaveBeenCalledWith('app_1', { status: 'INTERVIEW' }));
  });

  it('affiche des squelettes pendant le chargement', () => {
    renderTable({ isPending: true });

    expect(screen.getByRole('status')).toHaveAttribute('aria-busy', 'true');
    expect(screen.queryByRole('table')).not.toBeInTheDocument();
  });

  it('propose deux actions quand aucune candidature n_existe', () => {
    renderTable({ data: makeList([]) });

    expect(screen.getByText('Aucune candidature.')).toBeInTheDocument();
    expect(screen.getByText('Suivez une offre ou ajoutez une candidature.')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Voir les offres' })).toHaveAttribute('href', '/jobs');
    expect(screen.getByRole('button', { name: 'Ajouter une candidature' })).toBeInTheDocument();
  });

  it('propose d_effacer les filtres quand la recherche ne donne rien', async () => {
    const user = userEvent.setup();
    const onClearFilters = vi.fn();
    renderTable({ data: makeList([]), hasFilters: true, onClearFilters });

    expect(screen.getByText('Aucune candidature ne correspond.')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Effacer les filtres' }));
    expect(onClearFilters).toHaveBeenCalled();
  });

  it('affiche le message du serveur et un bouton Reessayer en cas d_echec', async () => {
    const user = userEvent.setup();
    const onRetry = vi.fn();
    renderTable({ isError: true, error: new ApiError('Service indisponible.', 503, 'SERVICE_UNAVAILABLE'), onRetry });

    expect(screen.getByText('Service indisponible.')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Réessayer' }));
    expect(onRetry).toHaveBeenCalled();
  });

  it('pagine quand le total depasse une page', () => {
    renderTable({ data: makeList([makeApplication()], { total: 45, limit: 20, page: 2 }) });

    expect(screen.getByRole('navigation', { name: 'Pagination' })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: '3' })).toHaveAttribute('href', '?page=3');
  });
});
