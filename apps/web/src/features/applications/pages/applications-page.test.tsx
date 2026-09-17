import type {
  ApplicationBoardDto,
  ApplicationDetailDto,
  ApplicationDto,
  ApplicationListResponseDto,
  ApplicationStatsDto,
} from '@jobtrack/shared';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, useLocation } from 'react-router-dom';
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { ApplicationsPage } from './applications-page';

const fetchApplications = vi.hoisted(() => vi.fn());
const fetchApplicationStats = vi.hoisted(() => vi.fn());
const fetchApplicationBoard = vi.hoisted(() => vi.fn());
const fetchApplication = vi.hoisted(() => vi.fn());
const deleteApplication = vi.hoisted(() => vi.fn());

vi.mock('@/services/api/applications', () => ({
  fetchApplications,
  fetchApplicationStats,
  fetchApplicationBoard,
  fetchApplication,
  deleteApplication,
  createApplication: vi.fn(),
  updateApplication: vi.fn(),
  moveApplication: vi.fn(),
}));

vi.mock('@/services/api/resume', () => ({
  fetchResumes: vi.fn().mockResolvedValue([]),
  fetchLetters: vi.fn().mockResolvedValue([]),
  fetchBaseResume: vi.fn(),
  fetchResume: vi.fn(),
  fetchLetter: vi.fn(),
  tailorResume: vi.fn(),
  updateResume: vi.fn(),
  updateResumeTemplate: vi.fn(),
  deleteResume: vi.fn(),
  createLetter: vi.fn(),
  updateLetter: vi.fn(),
  deleteLetter: vi.fn(),
}));

beforeAll(() => {
  window.scrollTo = vi.fn();
  Element.prototype.scrollIntoView = vi.fn();
});

const EMPTY_LIST: ApplicationListResponseDto = { items: [], page: 1, limit: 20, total: 0 };

const STATS: ApplicationStatsDto = {
  total: 4,
  byStatus: { TO_APPLY: 1, APPLIED: 2, INTERVIEW: 1, OFFER: 0, REJECTED: 0 },
  appliedThisWeek: 2,
  interviewRate: 0.5,
};

const APPLICATION: ApplicationDto = {
  id: 'app_1',
  jobId: null,
  status: 'APPLIED',
  position: 0,
  jobTitle: 'Business Analyst',
  company: 'Societe Generale',
  locationLabel: null,
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
};

const DETAIL: ApplicationDetailDto = {
  ...APPLICATION,
  events: [
    { id: 'evt_1', type: 'CREATED', fromStatus: null, toStatus: null, note: null, createdAt: '2026-09-15T08:00:00.000Z' },
  ],
};

const BOARD: ApplicationBoardDto = {
  columns: { TO_APPLY: [], APPLIED: [APPLICATION], INTERVIEW: [], OFFER: [], REJECTED: [] },
};

beforeEach(() => {
  fetchApplications.mockResolvedValue(EMPTY_LIST);
  fetchApplicationStats.mockResolvedValue(STATS);
  fetchApplicationBoard.mockResolvedValue(BOARD);
  fetchApplication.mockResolvedValue(DETAIL);
  deleteApplication.mockResolvedValue(undefined);
});

afterEach(() => {
  fetchApplications.mockReset();
  fetchApplicationStats.mockReset();
  fetchApplicationBoard.mockReset();
  fetchApplication.mockReset();
  deleteApplication.mockReset();
});

function Search() {
  const location = useLocation();
  return <output data-testid="search">{location.search}</output>;
}

function renderPage(initialEntry = '/applications') {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });

  return render(
    <MemoryRouter initialEntries={[initialEntry]}>
      <QueryClientProvider client={queryClient}>
        <ApplicationsPage />
        <Search />
      </QueryClientProvider>
    </MemoryRouter>,
  );
}

describe('ApplicationsPage', () => {
  it('affiche le titre et le sous-titre de la page', async () => {
    renderPage();

    expect(screen.getByRole('heading', { level: 1, name: 'Mes candidatures' })).toBeInTheDocument();
    expect(screen.getByText('Chaque candidature, son statut, sa source et le CV utilisé.')).toBeInTheDocument();
    await waitFor(() => expect(fetchApplications).toHaveBeenCalled());
  });

  it('affiche le compteur reel de chaque onglet une fois les stats connues', async () => {
    renderPage();

    // Avant la reponse de `GET /applications/stats`, l'onglet ne porte qu'un
    // squelette : jamais un zero, qui serait faux.
    expect(screen.getByRole('tab', { name: 'Toutes' })).toBeInTheDocument();

    expect(await screen.findByRole('tab', { name: 'Toutes 4' })).toBeInTheDocument();
    expect(screen.getByRole('tab', { name: 'Envoyées 2' })).toBeInTheDocument();
    expect(screen.getByRole('tab', { name: 'Offre 0' })).toBeInTheDocument();
  });

  it('bascule vers la vue Kanban et l_ecrit dans l_URL', async () => {
    const user = userEvent.setup();
    renderPage();

    const kanban = screen.getByRole('button', { name: 'Vue Kanban' });
    expect(kanban).toHaveAttribute('aria-pressed', 'false');

    await user.click(kanban);

    expect(screen.getByTestId('search').textContent).toBe('?vue=kanban');
    expect(screen.getByRole('button', { name: 'Vue Kanban' })).toHaveAttribute('aria-pressed', 'true');
    expect(await screen.findByText('Societe Generale')).toBeInTheDocument();
  });

  it('revient a la vue table, qui n_ecrit rien dans l_URL', async () => {
    const user = userEvent.setup();
    renderPage('/applications?vue=kanban');

    await user.click(screen.getByRole('button', { name: 'Vue table' }));

    expect(screen.getByTestId('search').textContent).toBe('');
    await waitFor(() => expect(screen.queryByText('Societe Generale')).not.toBeInTheDocument());
  });

  it('filtre par onglet et transmet l_onglet a l_API', async () => {
    const user = userEvent.setup();
    renderPage();

    await user.click(await screen.findByRole('tab', { name: /Entretien/ }));

    expect(screen.getByTestId('search').textContent).toBe('?onglet=interview');
    await waitFor(() => expect(fetchApplications).toHaveBeenCalledWith(expect.objectContaining({ tab: 'interview' })));
  });

  it('porte la recherche dans l_URL apres la temporisation', async () => {
    const user = userEvent.setup();
    renderPage();

    await user.type(screen.getByLabelText('Rechercher un poste ou une entreprise'), 'analyst');

    await waitFor(() => expect(screen.getByTestId('search').textContent).toBe('?q=analyst'));
    await waitFor(() => expect(fetchApplications).toHaveBeenCalledWith(expect.objectContaining({ q: 'analyst' })));
  });

  it('ouvre le formulaire depuis ?ajouter=1 et le referme', async () => {
    const user = userEvent.setup();
    renderPage('/applications?ajouter=1');

    expect(await screen.findByRole('dialog')).toBeInTheDocument();
    expect(screen.getByLabelText('Poste *')).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Annuler' }));

    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
    expect(screen.getByTestId('search').textContent).toBe('');
  });

  it('ouvre le formulaire par le bouton Ajouter une candidature', async () => {
    const user = userEvent.setup();
    renderPage();

    await user.click(screen.getAllByRole('button', { name: 'Ajouter une candidature' })[0] as HTMLElement);

    expect(screen.getByTestId('search').textContent).toBe('?ajouter=1');
    expect(await screen.findByRole('dialog')).toBeInTheDocument();
  });

  it('ecrit la candidature ouverte dans l_URL depuis la table', async () => {
    const user = userEvent.setup();
    fetchApplications.mockResolvedValue({
      ...EMPTY_LIST,
      total: 1,
      items: [
        {
          id: 'app_1',
          jobId: null,
          status: 'APPLIED',
          position: 0,
          jobTitle: 'Business Analyst',
          company: 'Societe Generale',
          locationLabel: null,
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
        },
      ],
    });
    renderPage();

    const [open] = await screen.findAllByRole('button', { name: 'Ouvrir Business Analyst' });
    await user.click(open as HTMLElement);

    expect(screen.getByTestId('search').textContent).toBe('?candidature=app_1');
  });

  it('vue Kanban : rend les cinq colonnes du contrat et leurs cartes', async () => {
    renderPage('/applications?vue=kanban');

    expect(await screen.findByText('Societe Generale')).toBeInTheDocument();
    const columns = screen.getAllByRole('heading', { level: 3 }).map((node) => node.textContent);
    expect(columns).toEqual(['À postuler', 'Candidature envoyée', 'Entretien', 'Offre', 'Refusée']);
  });

  it('ouvre la fiche depuis une carte du Kanban', async () => {
    const user = userEvent.setup();
    renderPage('/applications?vue=kanban');

    await user.click(await screen.findByRole('button', { name: 'Ouvrir la candidature Business Analyst' }));

    expect(screen.getByTestId('search').textContent).toBe('?vue=kanban&candidature=app_1');
  });

  it('ouvre le panneau de detail depuis ?candidature=', async () => {
    renderPage('/applications?candidature=app_1');

    expect(await screen.findByRole('heading', { level: 2, name: 'Business Analyst' })).toBeInTheDocument();
    expect(fetchApplication).toHaveBeenCalledWith('app_1');
    expect(screen.getByText('Candidature créée')).toBeInTheDocument();
  });

  it('refermer le panneau retire ?candidature de l_URL', async () => {
    const user = userEvent.setup();
    renderPage('/applications?candidature=app_1');

    await screen.findByRole('heading', { level: 2, name: 'Business Analyst' });
    await user.click(screen.getByRole('button', { name: 'Fermer' }));

    await waitFor(() => expect(screen.getByTestId('search').textContent).toBe(''));
  });

  it('supprimer depuis le panneau retire aussi ?candidature de l_URL', async () => {
    const user = userEvent.setup();
    renderPage('/applications?candidature=app_1');

    await screen.findByRole('heading', { level: 2, name: 'Business Analyst' });
    await user.click(screen.getByRole('button', { name: 'Supprimer' }));
    await user.click(screen.getByRole('button', { name: 'Supprimer définitivement' }));

    await waitFor(() => expect(deleteApplication).toHaveBeenCalledWith('app_1'));
    await waitFor(() => expect(screen.getByTestId('search').textContent).toBe(''));
  });

  it('la page consultee est conservee en refermant le panneau de detail', async () => {
    const user = userEvent.setup();
    renderPage('/applications?page=3&candidature=app_1');

    await screen.findByRole('heading', { level: 2, name: 'Business Analyst' });
    await user.click(screen.getByRole('button', { name: 'Fermer' }));

    await waitFor(() => expect(screen.getByTestId('search').textContent).toBe('?page=3'));
  });
});
