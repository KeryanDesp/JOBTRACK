import type { JobDetailDto } from '@jobtrack/shared';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ApiError } from '@/services/api/client';
import { JobDetailPage } from './job-detail-page';

const fetchJob = vi.hoisted(() => vi.fn());

vi.mock('@/services/api/jobs', () => ({
  fetchJob,
  saveJob: vi.fn(),
  unsaveJob: vi.fn(),
  fetchJobsCapabilities: vi.fn(),
  fetchSavedJobs: vi.fn(),
  searchCommunes: vi.fn(),
  searchJobs: vi.fn(),
}));

afterEach(() => fetchJob.mockReset());

function makeDetail(overrides: Partial<JobDetailDto> = {}): JobDetailDto {
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
    salaryMinAnnual: 45_000,
    salaryMaxAnnual: 55_000,
    salaryLabel: null,
    currency: 'EUR',
    publishedAt: new Date(Date.now() - 2 * 3_600_000).toISOString(),
    expiredAt: null,
    description: 'Rejoignez notre équipe pour construire des produits utiles.',
    companyDescription: null,
    companyUrl: null,
    communeCode: '57463',
    postalCode: '57000',
    latitude: null,
    longitude: null,
    contractNature: null,
    experienceLabel: null,
    experienceRequired: null,
    workingTimeLabel: null,
    isFullTime: null,
    isApprenticeship: false,
    positionsCount: null,
    accessibleTh: null,
    sectorLabel: null,
    romeCode: null,
    romeLabel: null,
    qualificationLabel: null,
    sourceUpdatedAt: null,
    lastSeenAt: new Date(Date.now() - 3_600_000).toISOString(),
    skills: [
      { name: 'TypeScript', required: true },
      { name: 'Figma', required: false },
    ],
    sources: [
      {
        kind: 'FRANCE_TRAVAIL',
        externalId: 'ft-1',
        url: 'https://candidat.francetravail.fr/offres/recherche/detail/job-1',
        applyUrl: null,
        partnerName: null,
        publishedAt: new Date(Date.now() - 2 * 3_600_000).toISOString(),
      },
    ],
    requirements: [{ kind: 'LANGUAGE', label: 'Anglais courant', required: true }],
    saved: false,
    ...overrides,
  };
}

function renderPage(id = 'job-1') {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={client}>
      <MemoryRouter initialEntries={[`/jobs/${id}`]}>
        <Routes>
          <Route path="/jobs/:id" element={<JobDetailPage />} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

describe('JobDetailPage', () => {
  it('affiche l_en_tete, les badges, la description, les competences, les exigences et les sources', async () => {
    fetchJob.mockResolvedValue(makeDetail());
    renderPage();

    expect(await screen.findByRole('heading', { name: 'Développeuse full-stack' })).toBeInTheDocument();
    expect(screen.getByText('CDI')).toBeInTheDocument();
    expect(screen.getByText('45–55 k€')).toBeInTheDocument();
    expect(screen.getByText('Rejoignez notre équipe pour construire des produits utiles.')).toBeInTheDocument();
    expect(screen.getByText('TypeScript')).toBeInTheDocument();
    expect(screen.getByText('Anglais courant (exigé)')).toBeInTheDocument();

    // Deux fois dans le DOM (actions desktop + barre collante mobile, spec tâche 9) : une
    // seule est visible selon la taille d'écran, mais les deux portent les mêmes attributs.
    const [externalLink] = screen.getAllByRole('link', { name: "Voir l'offre sur France Travail" });
    expect(externalLink).toHaveAttribute('href', 'https://candidat.francetravail.fr/offres/recherche/detail/job-1');
    expect(externalLink).toHaveAttribute('target', '_blank');
    expect(externalLink).toHaveAttribute('rel', 'noopener noreferrer');
  });

  it('affiche un message d_offre introuvable avec un lien de retour sur une 404', async () => {
    fetchJob.mockRejectedValue(new ApiError('Offre introuvable.', 404));
    renderPage();

    expect(await screen.findByText('Offre introuvable.')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Retour aux offres' })).toHaveAttribute('href', '/jobs');
  });

  it('signale une offre qui n_est plus publiee', async () => {
    fetchJob.mockResolvedValue(makeDetail({ expiredAt: '2026-09-10T00:00:00.000Z' }));
    renderPage();

    expect(await screen.findByText("Cette offre n'est plus publiée.")).toBeInTheDocument();
  });

  it('replie une description longue derriere Voir plus', async () => {
    const longDescription = 'Paragraphe très détaillé. '.repeat(60);
    fetchJob.mockResolvedValue(makeDetail({ description: longDescription }));
    renderPage();

    const showMore = await screen.findByRole('button', { name: 'Voir plus' });
    expect(screen.getByText(/…$/)).toBeInTheDocument();

    const user = userEvent.setup();
    await user.click(showMore);

    expect(screen.getByRole('button', { name: 'Voir moins' })).toBeInTheDocument();
    expect(screen.getByText(longDescription.trim())).toBeInTheDocument();
  });
});
