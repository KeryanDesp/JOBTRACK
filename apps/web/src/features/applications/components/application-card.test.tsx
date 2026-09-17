import type { ApplicationDto } from '@jobtrack/shared';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { ApplicationCard } from './application-card';

vi.mock('@/services/api/applications', () => ({
  createApplication: vi.fn(),
  deleteApplication: vi.fn(),
  fetchApplication: vi.fn(),
  fetchApplicationBoard: vi.fn(),
  fetchApplicationStats: vi.fn(),
  fetchApplications: vi.fn(),
  moveApplication: vi.fn(),
  updateApplication: vi.fn(),
}));

vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn() } }));

function makeApplication(overrides: Partial<ApplicationDto> = {}): ApplicationDto {
  return {
    id: 'app-1',
    jobId: null,
    status: 'APPLIED',
    position: 0,
    jobTitle: 'Developpeur React',
    company: 'Acme',
    locationLabel: 'Metz (57)',
    salaryLabel: '45–55 k€',
    contractLabel: 'CDI',
    source: 'LINKEDIN',
    sourceUrl: null,
    appliedAt: '2026-09-15',
    usedBaseResume: false,
    resumeId: null,
    coverLetterId: null,
    notes: null,
    createdAt: '2026-09-10T08:00:00.000Z',
    updatedAt: '2026-09-15T08:00:00.000Z',
    job: null,
    resume: null,
    coverLetter: null,
    ...overrides,
  };
}

function renderCard(application: ApplicationDto = makeApplication(), presentational = false) {
  const onOpen = vi.fn();
  const client = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  const { container } = render(
    <QueryClientProvider client={client}>
      <ApplicationCard application={application} onOpen={onOpen} presentational={presentational} />
    </QueryClientProvider>,
  );
  return { onOpen, container };
}

describe('ApplicationCard', () => {
  it('affiche l_entreprise, le poste, le salaire, la date et la source', () => {
    renderCard();

    expect(screen.getByText('Acme')).toBeInTheDocument();
    expect(screen.getByText('Developpeur React')).toBeInTheDocument();
    expect(screen.getByText('45–55 k€')).toBeInTheDocument();
    expect(screen.getByText('15 sept. 2026')).toBeInTheDocument();
    expect(screen.getByText('LinkedIn')).toBeInTheDocument();
  });

  it('affiche un tiret quand la candidature n_a pas encore de date', () => {
    renderCard(makeApplication({ appliedAt: null }));

    expect(screen.getByText('—')).toBeInTheDocument();
  });

  it('affiche la pastille de correspondance quand l_offre a un score', () => {
    renderCard(
      makeApplication({
        jobId: 'job-1',
        job: {
          id: 'job-1',
          title: 'Developpeur React',
          company: 'Acme',
          match: { score: 92, band: 'EXCELLENT', priority: 'VERY_HIGH', explanation: { top: [], weak: [] } },
        },
      }),
    );

    expect(screen.getByRole('img', { name: 'Correspondance 92 sur 100' })).toBeInTheDocument();
  });

  it('n_affiche aucune pastille de correspondance sans offre rattachee', () => {
    renderCard();

    expect(screen.queryByRole('img')).not.toBeInTheDocument();
  });

  it('ouvre la fiche au clic sur le corps de la carte', async () => {
    const user = userEvent.setup();
    const { onOpen } = renderCard();

    await user.click(screen.getByRole('button', { name: 'Ouvrir la candidature Developpeur React' }));

    expect(onOpen).toHaveBeenCalledWith('app-1');
  });

  it('en mode presentation, affiche le meme contenu sans aucune commande', () => {
    const { container } = renderCard(makeApplication(), true);

    expect(screen.getByText('Acme')).toBeInTheDocument();
    expect(screen.getByText('Developpeur React')).toBeInTheDocument();
    expect(screen.getByText('15 sept. 2026')).toBeInTheDocument();
    // Ni bouton d'ouverture, ni poignee, ni menu « Deplacer vers… » : la copie
    // rendue dans le `DragOverlay` ne doit rien dupliquer.
    expect(container.querySelectorAll('button')).toHaveLength(0);
    expect(container.querySelector('[aria-hidden="true"]')).toBeInTheDocument();
  });

  it('porte une poignee de deplacement nommee, distincte du corps cliquable', async () => {
    const user = userEvent.setup();
    const { onOpen } = renderCard();

    const handle = screen.getByRole('button', { name: 'Déplacer Developpeur React' });
    await user.click(handle);

    expect(onOpen).not.toHaveBeenCalled();
  });
});
