import type { JobDetailDto } from '@jobtrack/shared';
import { QueryClient, QueryClientProvider, useQuery } from '@tanstack/react-query';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { TooltipProvider } from '@/components/ui/tooltip';
import { jobKeys } from '../lib/query-keys';
import { JobDetailHeader } from './job-detail-header';

const saveJob = vi.hoisted(() => vi.fn());
const unsaveJob = vi.hoisted(() => vi.fn());

vi.mock('@/services/api/jobs', () => ({
  saveJob,
  unsaveJob,
  fetchJob: vi.fn(),
  fetchJobsCapabilities: vi.fn(),
  fetchSavedJobs: vi.fn(),
  searchCommunes: vi.fn(),
  searchJobs: vi.fn(),
}));

afterEach(() => {
  saveJob.mockReset();
  unsaveJob.mockReset();
});

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
    salaryMinAnnual: null,
    salaryMaxAnnual: null,
    salaryLabel: null,
    currency: 'EUR',
    publishedAt: new Date(Date.now() - 3_600_000).toISOString(),
    expiredAt: null,
    description: '',
    companyDescription: null,
    companyUrl: null,
    communeCode: null,
    postalCode: null,
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
    lastSeenAt: new Date().toISOString(),
    skills: [],
    sources: [
      {
        kind: 'FRANCE_TRAVAIL',
        externalId: 'ft-1',
        url: 'https://candidat.francetravail.fr/offres/recherche/detail/job-1',
        applyUrl: null,
        partnerName: null,
        publishedAt: new Date().toISOString(),
      },
    ],
    requirements: [],
    saved: false,
    ...overrides,
  };
}

function renderHeader(job: JobDetailDto) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  render(
    <QueryClientProvider client={client}>
      <MemoryRouter>
        <TooltipProvider>
          <JobDetailHeader job={job} />
        </TooltipProvider>
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

/**
 * `JobDetailHeader` reçoit `job` en prop, contrôlé par l'appelant réel
 * (`JobDetailPage`, lui-même abonné à `useJob`). Ce harnais reproduit cette
 * subscription minimale sur `jobKeys.detail` (même principe que
 * `save-job-button.test.tsx`) pour que la mise à jour optimiste faite par
 * `useSaveJob` (dans `onMutate`) se reflète bien dans le `saved` affiché.
 */
function Harness({ job }: { job: JobDetailDto }) {
  const query = useQuery<JobDetailDto>({
    queryKey: jobKeys.detail(job.id),
    queryFn: () => Promise.resolve(job),
    enabled: false,
  });
  return <JobDetailHeader job={query.data ?? job} />;
}

function renderHarness(job: JobDetailDto) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  client.setQueryData(jobKeys.detail(job.id), job);
  render(
    <QueryClientProvider client={client}>
      <MemoryRouter>
        <TooltipProvider>
          <Harness job={job} />
        </TooltipProvider>
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

describe('JobDetailHeader', () => {
  it('positionne la barre d_actions mobile au-dessus de la navigation basse', () => {
    renderHeader(makeDetail());

    const bar = document.querySelector('.mobile-action-bar');
    expect(bar).not.toBeNull();
    expect(bar).toHaveClass('bottom-[calc(4rem+env(safe-area-inset-bottom))]');
  });

  it('bascule sauvegarder/retirer depuis un seul bouton icone plus texte', async () => {
    saveJob.mockResolvedValue(undefined);
    const user = userEvent.setup();
    renderHarness(makeDetail({ saved: false }));

    const [saveButton] = screen.getAllByRole('button', { name: 'Sauvegarder' });
    if (!saveButton) throw new Error('Bouton "Sauvegarder" introuvable.');
    expect(saveButton).toHaveAttribute('aria-pressed', 'false');

    await user.click(saveButton);

    await waitFor(() => {
      expect(screen.getAllByRole('button', { name: 'Retirer des favoris' })[0]).toHaveAttribute('aria-pressed', 'true');
    });
    expect(saveJob).toHaveBeenCalledWith('job-1');
  });

  it('rend les libelles bruts du salaire et de l_experience quand ils ne sont pas reconnus', () => {
    renderHeader(
      makeDetail({
        salaryMinAnnual: null,
        salaryMaxAnnual: null,
        salaryLabel: 'Selon profil',
        experienceLevel: null,
        experienceLabel: '3 ans minimum',
        experienceRequired: false,
      }),
    );

    expect(screen.getByText('Selon profil')).toBeInTheDocument();
    expect(screen.getByText('3 ans minimum')).toBeInTheDocument();
    expect(screen.getByText('Débutant accepté')).toBeInTheDocument();
  });

  it('rend l_info_bulle de teletravail deduit accessible au clavier', async () => {
    const user = userEvent.setup();
    renderHeader(makeDetail({ remoteMode: 'HYBRID', remoteModeInferred: true }));

    const trigger = screen.getByRole('button', { name: 'Hybride' });
    trigger.focus();
    expect(trigger).toHaveFocus();

    await user.hover(trigger);
    expect(await screen.findByText("Télétravail mentionné dans l'annonce")).toBeInTheDocument();
  });

  it('cible en priorite la premiere source dont l_url est http(s) pour le CTA externe', () => {
    renderHeader(
      makeDetail({
        sources: [
          { kind: 'FRANCE_TRAVAIL', externalId: 'bad', url: 'ftp://exemple.invalide', applyUrl: null, partnerName: null, publishedAt: new Date().toISOString() },
          {
            kind: 'FRANCE_TRAVAIL',
            externalId: 'ft-2',
            url: 'https://candidat.francetravail.fr/offres/recherche/detail/job-1',
            applyUrl: null,
            partnerName: null,
            publishedAt: new Date().toISOString(),
          },
        ],
      }),
    );

    const [link] = screen.getAllByRole('link', { name: "Voir l'offre sur France Travail" });
    expect(link).toHaveAttribute('href', 'https://candidat.francetravail.fr/offres/recherche/detail/job-1');
  });
});
