import type { JobSummaryDto } from '@jobtrack/shared';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { FavoritesPage } from './favorites-page';

const fetchSavedJobs = vi.hoisted(() => vi.fn());
const unsaveJob = vi.hoisted(() => vi.fn());

vi.mock('@/services/api/jobs', () => ({
  fetchSavedJobs,
  fetchJob: vi.fn(),
  saveJob: vi.fn(),
  unsaveJob,
  fetchJobsCapabilities: vi.fn(),
  searchCommunes: vi.fn(),
  searchJobs: vi.fn(),
}));

afterEach(() => {
  fetchSavedJobs.mockReset();
  unsaveJob.mockReset();
});

function makeSummary(overrides: Partial<JobSummaryDto> = {}): JobSummaryDto {
  return {
    id: 'job-1',
    title: 'Développeuse full-stack',
    company: 'Acme',
    companyLogoUrl: null,
    locationLabel: 'Metz (57)',
    departmentCode: '57',
    contractType: 'CDI',
    contractLabel: 'CDI',
    remoteMode: null,
    remoteModeInferred: false,
    experienceLevel: null,
    salaryMinAnnual: null,
    salaryMaxAnnual: null,
    salaryLabel: null,
    currency: 'EUR',
    publishedAt: new Date(Date.now() - 2 * 3_600_000).toISOString(),
    expiredAt: null,
    skills: [],
    sources: ['FRANCE_TRAVAIL'],
    saved: true,
    match: null,
    ...overrides,
  };
}

function renderPage() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={client}>
      <MemoryRouter>
        <FavoritesPage />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

describe('FavoritesPage', () => {
  it('affiche l_etat vide avec un lien vers les offres', async () => {
    fetchSavedJobs.mockResolvedValue([]);
    renderPage();

    expect(await screen.findByText('Aucune offre sauvegardée.')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Parcourir les offres' })).toBeInTheDocument();
  });

  it('affiche la liste des favoris et leur nombre dans le sous_titre', async () => {
    fetchSavedJobs.mockResolvedValue([makeSummary({ id: 'job-1' }), makeSummary({ id: 'job-2', title: 'Data analyste' })]);
    renderPage();

    expect(await screen.findByText('Développeuse full-stack')).toBeInTheDocument();
    expect(screen.getByText('Data analyste')).toBeInTheDocument();
    expect(screen.getByText('2 offres sauvegardées.')).toBeInTheDocument();
  });

  it('le retrait optimiste d_un favori retire sa carte de la liste', async () => {
    unsaveJob.mockResolvedValue(undefined);
    // `useSaveJob` invalide et refait la requête des favoris une fois la mutation réglée (spec
    // §7) : un vrai serveur ne renverrait plus l'offre retirée, d'où le second mock — sans lui,
    // cette re-synchronisation réafficherait les deux offres et masquerait le retrait optimiste.
    fetchSavedJobs
      .mockResolvedValueOnce([makeSummary({ id: 'job-1' }), makeSummary({ id: 'job-2', title: 'Data analyste' })])
      .mockResolvedValue([makeSummary({ id: 'job-2', title: 'Data analyste' })]);
    const user = userEvent.setup();
    renderPage();

    await screen.findByText('Développeuse full-stack');
    const [firstRemoveButton] = screen.getAllByRole('button', { name: 'Retirer des favoris' });
    if (!firstRemoveButton) throw new Error('Bouton "Retirer des favoris" introuvable.');
    await user.click(firstRemoveButton);

    await waitFor(() => {
      expect(screen.queryByText('Développeuse full-stack')).not.toBeInTheDocument();
    });
    expect(screen.getByText('Data analyste')).toBeInTheDocument();
    expect(unsaveJob).toHaveBeenCalledWith('job-1');
  });
});
