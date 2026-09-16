import type { JobSummaryDto } from '@jobtrack/shared';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { FavoritesPage } from './favorites-page';

const fetchSavedJobs = vi.hoisted(() => vi.fn());

vi.mock('@/services/api/jobs', () => ({
  fetchSavedJobs,
  fetchJob: vi.fn(),
  saveJob: vi.fn(),
  unsaveJob: vi.fn(),
  fetchJobsCapabilities: vi.fn(),
  searchCommunes: vi.fn(),
  searchJobs: vi.fn(),
}));

afterEach(() => fetchSavedJobs.mockReset());

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
});
