import type { JobListResponseDto, JobSummaryDto } from '@jobtrack/shared';
import { jobSearchQuerySchema } from '@jobtrack/shared';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { describe, expect, it, vi } from 'vitest';
import { TooltipProvider } from '@/components/ui/tooltip';
import { ApiError } from '@/services/api/client';
import { JobList } from './job-list';

vi.mock('@/services/api/jobs', () => ({
  saveJob: vi.fn(),
  unsaveJob: vi.fn(),
  fetchJob: vi.fn(),
  fetchJobsCapabilities: vi.fn(),
  fetchSavedJobs: vi.fn(),
  searchCommunes: vi.fn(),
  searchJobs: vi.fn(),
}));

const QUERY = jobSearchQuerySchema.parse({});

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
    publishedAt: '2026-09-15T00:00:00.000Z',
    expiredAt: null,
    skills: [],
    sources: ['FRANCE_TRAVAIL'],
    saved: false,
    ...overrides,
  };
}

function makeList(overrides: Partial<JobListResponseDto> = {}): JobListResponseDto {
  return {
    items: [],
    total: 0,
    page: 1,
    pageSize: 20,
    sync: { status: 'ok', syncedAt: null, message: null },
    ...overrides,
  };
}

interface RenderOverrides {
  data?: JobListResponseDto;
  isError?: boolean;
  error?: unknown;
  onRetry?: () => void;
  onPageChange?: (page: number) => void;
}

function renderList({ data, isError = false, error, onRetry = vi.fn(), onPageChange = vi.fn() }: RenderOverrides) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={client}>
      <MemoryRouter>
        <TooltipProvider>
          <JobList
            data={data}
            query={QUERY}
            isPending={false}
            isError={isError}
            error={error}
            isPlaceholderData={false}
            onRetry={onRetry}
            onPageChange={onPageChange}
            onResetFilters={undefined}
          />
        </TooltipProvider>
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

describe('JobList', () => {
  it('affiche un ErrorState quand une erreur survient sans aucune donnee en cache', () => {
    const onRetry = vi.fn();
    renderList({ data: undefined, isError: true, error: new ApiError('Trop de requêtes.', 429, 'RATE_LIMITED'), onRetry });

    expect(screen.getByRole('alert')).toHaveTextContent('Trop de requêtes.');
    expect(screen.getByRole('button', { name: 'Réessayer' })).toBeInTheDocument();
    expect(screen.queryByText('Développeuse full-stack')).not.toBeInTheDocument();
  });

  it('garde la liste affichee et montre une alerte quand une reactualisation echoue (429)', () => {
    renderList({
      data: makeList({ items: [makeSummary()], total: 1 }),
      isError: true,
      error: new ApiError("Trop d'actualisations. Réessayez dans quelques minutes.", 429, 'RATE_LIMITED'),
    });

    expect(screen.getByText('Développeuse full-stack')).toBeInTheDocument();
    expect(screen.getByText("Trop d'actualisations. Réessayez dans quelques minutes.")).toBeInTheDocument();
  });

  it('traduit VALIDATION_ERROR en message dedie au lieu du message brut du serveur', () => {
    renderList({
      data: makeList({ items: [makeSummary()], total: 1 }),
      isError: true,
      error: new ApiError('communes.0: Code commune invalide.', 400, 'VALIDATION_ERROR'),
    });

    expect(screen.getByText('Recherche invalide : vérifiez les filtres.')).toBeInTheDocument();
    expect(screen.queryByText('communes.0: Code commune invalide.')).not.toBeInTheDocument();
  });

  it('affiche un message generique pour une erreur qui n_est pas une ApiError', () => {
    renderList({ data: makeList({ items: [makeSummary()], total: 1 }), isError: true, error: new Error('boom') });

    expect(screen.getByText('Impossible de charger les offres.')).toBeInTheDocument();
  });

  it('construit des liens de pagination reels et respecte les clics avec modificateur', () => {
    const onPageChange = vi.fn();
    renderList({ data: makeList({ items: [makeSummary()], total: 45, page: 1 }), onPageChange });

    const pageTwo = screen.getByRole('link', { name: '2' });
    expect(pageTwo).toHaveAttribute('href', expect.stringContaining('page=2'));

    fireEvent.click(pageTwo, { metaKey: true });
    expect(onPageChange).not.toHaveBeenCalled();

    fireEvent.click(pageTwo);
    expect(onPageChange).toHaveBeenCalledWith(2);
  });
});
