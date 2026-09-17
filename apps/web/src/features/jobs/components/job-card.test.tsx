import type { JobSummaryDto } from '@jobtrack/shared';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { TooltipProvider } from '@/components/ui/tooltip';
import { JobCard } from './job-card';

vi.mock('@/services/api/jobs', () => ({
  saveJob: vi.fn(),
  unsaveJob: vi.fn(),
  fetchJob: vi.fn(),
  fetchJobsCapabilities: vi.fn(),
  fetchSavedJobs: vi.fn(),
  searchCommunes: vi.fn(),
  searchJobs: vi.fn(),
}));

afterEach(() => vi.clearAllMocks());

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
    saved: false,
    ...overrides,
  };
}

function renderCard(job: JobSummaryDto) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={client}>
      <MemoryRouter>
        <TooltipProvider>
          <JobCard job={job} />
        </TooltipProvider>
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

describe('JobCard', () => {
  it('affiche le salaire et la fraicheur relative', () => {
    renderCard(makeSummary({ salaryMinAnnual: 45_000, salaryMaxAnnual: 70_000 }));

    expect(screen.getByText('45–70 k€')).toBeInTheDocument();
    expect(screen.getByText(/Publié il y a 2 heures/)).toBeInTheDocument();
  });

  it('affiche une info-bulle quand le teletravail est deduit du texte de l_annonce', async () => {
    const user = userEvent.setup();
    renderCard(makeSummary({ remoteMode: 'HYBRID', remoteModeInferred: true }));

    await user.hover(screen.getByText('Hybride'));
    expect(await screen.findByText("Télétravail mentionné dans l'annonce")).toBeInTheDocument();
  });

  it('signale une offre qui n_est plus publiee', () => {
    renderCard(makeSummary({ expiredAt: '2026-09-10T00:00:00.000Z' }));

    expect(screen.getByText('Plus publiée')).toBeInTheDocument();
  });
});
