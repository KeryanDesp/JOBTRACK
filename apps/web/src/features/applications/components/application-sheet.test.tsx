import type { ApplicationDetailDto } from '@jobtrack/shared';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { ApiError } from '@/services/api/client';
import { ApplicationSheet } from './application-sheet';

const fetchApplication = vi.hoisted(() => vi.fn());
const updateApplication = vi.hoisted(() => vi.fn());
const deleteApplication = vi.hoisted(() => vi.fn());

vi.mock('@/services/api/applications', () => ({
  fetchApplication,
  updateApplication,
  deleteApplication,
  createApplication: vi.fn(),
  fetchApplicationBoard: vi.fn(),
  fetchApplicationStats: vi.fn(),
  fetchApplications: vi.fn(),
  moveApplication: vi.fn(),
}));

const fetchResumes = vi.hoisted(() => vi.fn());
const fetchLetters = vi.hoisted(() => vi.fn());

vi.mock('@/services/api/resume', () => ({
  fetchResumes,
  fetchLetters,
  createLetter: vi.fn(),
  deleteLetter: vi.fn(),
  deleteResume: vi.fn(),
  fetchBaseResume: vi.fn(),
  fetchLetter: vi.fn(),
  fetchResume: vi.fn(),
  tailorResume: vi.fn(),
  updateLetter: vi.fn(),
  updateResume: vi.fn(),
  updateResumeTemplate: vi.fn(),
}));

vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn() } }));

// jsdom n'implémente pas `scrollIntoView`, que Radix Select appelle à
// l'ouverture (même stub que `job-sort-select.test.tsx`).
beforeAll(() => {
  Element.prototype.scrollIntoView = vi.fn();
});

afterEach(() => {
  fetchApplication.mockReset();
  updateApplication.mockReset();
  deleteApplication.mockReset();
  fetchResumes.mockReset();
  fetchLetters.mockReset();
});

function makeDetail(overrides: Partial<ApplicationDetailDto> = {}): ApplicationDetailDto {
  return {
    id: 'app-1',
    jobId: 'job-1',
    status: 'APPLIED',
    position: 0,
    jobTitle: 'Developpeur React',
    company: 'Acme',
    locationLabel: 'Metz (57)',
    salaryLabel: '45–55 k€',
    contractLabel: 'CDI',
    source: 'LINKEDIN',
    sourceUrl: 'https://exemple.test/offre',
    appliedAt: '2026-09-15',
    usedBaseResume: false,
    resumeId: null,
    coverLetterId: null,
    notes: 'Relancer lundi',
    createdAt: '2026-09-10T08:00:00.000Z',
    updatedAt: '2026-09-15T08:00:00.000Z',
    job: { id: 'job-1', title: 'Developpeur React', company: 'Acme', match: null },
    resume: null,
    coverLetter: null,
    events: [{ id: 'evt-1', type: 'CREATED', fromStatus: null, toStatus: null, note: null, createdAt: '2026-09-10T08:00:00.000Z' }],
    ...overrides,
  };
}

function renderSheet(id: string | null = 'app-1') {
  const onClose = vi.fn();
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false, staleTime: Infinity }, mutations: { retry: false } },
  });
  render(
    <MemoryRouter>
      <QueryClientProvider client={client}>
        <ApplicationSheet id={id} onClose={onClose} />
      </QueryClientProvider>
    </MemoryRouter>,
  );
  return { onClose };
}

describe('ApplicationSheet', () => {
  it('charge et affiche la candidature, son lien vers l_offre et son historique', async () => {
    fetchApplication.mockResolvedValue(makeDetail());
    fetchResumes.mockResolvedValue([]);
    fetchLetters.mockResolvedValue([]);
    renderSheet();

    expect(await screen.findByRole('heading', { name: 'Developpeur React' })).toBeInTheDocument();
    expect(screen.getByText('Acme')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: "Voir l'offre" })).toHaveAttribute('href', '/jobs/job-1');
    expect(screen.getByText('LinkedIn')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: /Ouvrir/ })).toHaveAttribute('rel', 'noopener noreferrer');
    expect(screen.getByText('Candidature créée')).toBeInTheDocument();
  });

  it('propose les CV de l_utilisateur en plus de « Aucun » et « CV principal »', async () => {
    fetchApplication.mockResolvedValue(makeDetail());
    fetchResumes.mockResolvedValue([
      {
        id: 'cv-1',
        title: 'CV Business Analyst',
        jobId: 'job-1',
        jobTitle: null,
        company: null,
        template: 'MODERN',
        currentVersion: 1,
        createdAt: '2026-09-10T08:00:00.000Z',
        updatedAt: '2026-09-10T08:00:00.000Z',
      },
    ]);
    fetchLetters.mockResolvedValue([]);
    const user = userEvent.setup();
    renderSheet();

    await screen.findByRole('heading', { name: 'Developpeur React' });
    await user.click(screen.getByRole('combobox', { name: 'CV utilisé' }));

    expect(screen.getByRole('option', { name: 'Aucun' })).toBeInTheDocument();
    expect(screen.getByRole('option', { name: 'CV principal' })).toBeInTheDocument();
    expect(screen.getByRole('option', { name: 'CV Business Analyst' })).toBeInTheDocument();
  });

  it('enregistre immediatement un changement de statut et annonce « Enregistré »', async () => {
    fetchApplication.mockResolvedValue(makeDetail());
    fetchResumes.mockResolvedValue([]);
    fetchLetters.mockResolvedValue([]);
    updateApplication.mockResolvedValue(makeDetail({ status: 'INTERVIEW' }));
    const user = userEvent.setup();
    renderSheet();

    await screen.findByRole('heading', { name: 'Developpeur React' });
    await user.click(screen.getByRole('combobox', { name: 'Statut' }));
    await user.click(screen.getByRole('option', { name: 'Entretien' }));

    await waitFor(() => {
      expect(updateApplication).toHaveBeenCalledWith('app-1', { status: 'INTERVIEW' });
    });
    expect(await screen.findByText('Enregistré')).toBeInTheDocument();
  });

  it('enregistre la date de candidature des sa modification', async () => {
    fetchApplication.mockResolvedValue(makeDetail());
    fetchResumes.mockResolvedValue([]);
    fetchLetters.mockResolvedValue([]);
    updateApplication.mockResolvedValue(makeDetail({ appliedAt: '2026-09-20' }));
    renderSheet();

    await screen.findByRole('heading', { name: 'Developpeur React' });
    // `fireEvent.change` plutôt que `user.type` : un `input[type=date]` ne reçoit
    // jamais sa valeur caractère par caractère (le sélecteur natif la valide d'un
    // coup), et jsdom émettrait sinon une cascade de dates incomplètes.
    fireEvent.change(screen.getByLabelText('Date de candidature'), { target: { value: '2026-09-20' } });

    await waitFor(() => {
      expect(updateApplication).toHaveBeenCalledWith('app-1', { appliedAt: '2026-09-20' });
    });
  });

  it('n_active le bouton des notes qu_une fois le texte modifie', async () => {
    fetchApplication.mockResolvedValue(makeDetail());
    fetchResumes.mockResolvedValue([]);
    fetchLetters.mockResolvedValue([]);
    updateApplication.mockResolvedValue(makeDetail({ notes: 'Relancer lundi matin' }));
    const user = userEvent.setup();
    renderSheet();

    await screen.findByRole('heading', { name: 'Developpeur React' });
    const save = screen.getByRole('button', { name: 'Enregistrer les notes' });
    expect(save).toBeDisabled();

    await user.type(screen.getByLabelText('Notes'), ' matin');
    expect(save).toBeEnabled();

    await user.click(save);
    await waitFor(() => {
      expect(updateApplication).toHaveBeenCalledWith('app-1', { notes: 'Relancer lundi matin' });
    });
  });

  it('affiche un lien vers la lettre quand la candidature en porte une', async () => {
    fetchApplication.mockResolvedValue(makeDetail({ coverLetterId: 'letter-1', coverLetter: { id: 'letter-1', tone: 'PROFESSIONAL' } }));
    fetchResumes.mockResolvedValue([]);
    fetchLetters.mockResolvedValue([
      {
        id: 'letter-1',
        jobId: 'job-1',
        jobTitle: null,
        company: null,
        resumeId: null,
        tone: 'PROFESSIONAL',
        createdAt: '2026-09-10T08:00:00.000Z',
        updatedAt: '2026-09-10T08:00:00.000Z',
      },
    ]);
    renderSheet();

    expect(await screen.findByRole('link', { name: 'Voir la lettre' })).toHaveAttribute(
      'href',
      '/resume/letter/job-1?lettre=letter-1',
    );
  });

  it('candidature introuvable : message dedie et bouton Fermer', async () => {
    fetchApplication.mockRejectedValue(new ApiError('Introuvable', 404, 'APPLICATION_NOT_FOUND'));
    fetchResumes.mockResolvedValue([]);
    fetchLetters.mockResolvedValue([]);
    const user = userEvent.setup();
    const { onClose } = renderSheet();

    expect(await screen.findByText('Candidature introuvable.')).toBeInTheDocument();
    // Deux boutons nommés « Fermer » cohabitent (celui de l'état 404 et la croix
    // du `Sheet`) : la recherche est limitée au bloc d'état.
    await user.click(within(screen.getByRole('status')).getByRole('button', { name: 'Fermer' }));

    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('erreur serveur : message et bouton Reessayer', async () => {
    fetchApplication.mockRejectedValue(new ApiError('Indisponible', 500));
    fetchResumes.mockResolvedValue([]);
    fetchLetters.mockResolvedValue([]);
    renderSheet();

    expect(await screen.findByText("La candidature n'a pas pu être chargée.")).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Réessayer' })).toBeInTheDocument();
  });

  it('la suppression confirmee ferme le panneau', async () => {
    fetchApplication.mockResolvedValue(makeDetail());
    fetchResumes.mockResolvedValue([]);
    fetchLetters.mockResolvedValue([]);
    deleteApplication.mockResolvedValue(undefined);
    const user = userEvent.setup();
    const { onClose } = renderSheet();

    await screen.findByRole('heading', { name: 'Developpeur React' });
    await user.click(screen.getByRole('button', { name: 'Supprimer' }));
    await user.click(screen.getByRole('button', { name: 'Supprimer définitivement' }));

    await waitFor(() => {
      expect(deleteApplication).toHaveBeenCalledWith('app-1');
    });
    await waitFor(() => {
      expect(onClose).toHaveBeenCalledTimes(1);
    });
  });

  it('ne charge rien tant qu_aucune candidature n_est selectionnee', () => {
    renderSheet(null);

    expect(fetchApplication).not.toHaveBeenCalled();
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });
});
