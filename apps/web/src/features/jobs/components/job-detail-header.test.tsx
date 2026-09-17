import type { JobDetailDto, ResumeSummaryDto } from '@jobtrack/shared';
import { QueryClient, QueryClientProvider, useQuery } from '@tanstack/react-query';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, useLocation } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
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

// `JobDetailHeader` appelle `useResumes()` (tâche 7) pour filtrer les CV adaptés de l'offre
// proposés à `ApplicationFormDialog` — mock requis même quand ce dialogue lui-même est
// remplacé ci-dessous, ce hook restant, lui, appelé directement par l'en-tête.
const fetchResumes = vi.hoisted(() => vi.fn());

vi.mock('@/services/api/resume', () => ({
  fetchBaseResume: vi.fn(),
  updateResumeTemplate: vi.fn(),
  fetchResumes,
  fetchResume: vi.fn(),
  tailorResume: vi.fn(),
  updateResume: vi.fn(),
  deleteResume: vi.fn(),
  fetchLetters: vi.fn(),
  fetchLetter: vi.fn(),
  createLetter: vi.fn(),
  updateLetter: vi.fn(),
  deleteLetter: vi.fn(),
}));

/**
 * Remplace `ApplicationFormDialog` par un faux composant (tâche 7 : « mock
 * `ApplicationFormDialog` ou le rendre avec des providers ») : ce test porte
 * sur le câblage de `JobDetailHeader` (état partagé, filtrage des CV,
 * `onOpenApplication`), jamais sur le formulaire lui-même (couvert par son
 * propre fichier de test, hors périmètre de cette tâche). `applicationFormDialogSpy`
 * capture les props reçues à chaque rendu pour vérifier le filtrage des CV
 * adaptés sans avoir à ouvrir le dialogue.
 */
const applicationFormDialogSpy = vi.hoisted(() => vi.fn());

vi.mock('@/features/applications/components/application-form-dialog', () => ({
  ApplicationFormDialog: (props: {
    open: boolean;
    onOpenApplication: (id: string) => void;
  }) => {
    applicationFormDialogSpy(props);
    if (!props.open) return null;
    return (
      <div role="dialog">
        <button type="button" onClick={() => props.onOpenApplication('app-existing')}>
          Ouvrir la fiche (test)
        </button>
      </div>
    );
  },
}));

function makeResumeSummary(overrides: Partial<ResumeSummaryDto> = {}): ResumeSummaryDto {
  return {
    id: 'resume-1',
    title: 'CV Développeuse full-stack — Acme',
    jobId: 'job-1',
    jobTitle: 'Développeuse full-stack',
    company: 'Acme',
    template: 'CLASSIC',
    currentVersion: 1,
    createdAt: '2026-09-17T00:00:00.000Z',
    updatedAt: '2026-09-17T00:00:00.000Z',
    ...overrides,
  };
}

/** Affiche l'URL courante (tâche 7 : vérifie que `onOpenApplication` navigue bien). */
function LocationProbe() {
  const location = useLocation();
  return <div data-testid="location-probe">{`${location.pathname}${location.search}`}</div>;
}

beforeEach(() => {
  fetchResumes.mockResolvedValue([]);
});

afterEach(() => {
  saveJob.mockReset();
  unsaveJob.mockReset();
  fetchResumes.mockReset();
  applicationFormDialogSpy.mockReset();
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
    match: null,
    application: null,
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

/** Comme `renderHeader`, avec `LocationProbe` en plus pour vérifier une navigation (tâche 7). */
function renderHeaderWithProbe(job: JobDetailDto) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  render(
    <QueryClientProvider client={client}>
      <MemoryRouter>
        <TooltipProvider>
          <JobDetailHeader job={job} />
        </TooltipProvider>
        <LocationProbe />
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

  it('ouvre un seul dialogue de suivi partage malgre les deux instances du bouton (inline + barre mobile)', async () => {
    const user = userEvent.setup();
    renderHeader(makeDetail({ application: null }));

    const [inlineTrigger, mobileTrigger] = screen.getAllByRole('button', { name: 'Suivre cette candidature' });
    if (!inlineTrigger || !mobileTrigger) throw new Error('Boutons "Suivre cette candidature" introuvables.');

    await user.click(inlineTrigger);
    expect(await screen.findByRole('dialog')).toBeInTheDocument();
    expect(screen.getAllByRole('dialog')).toHaveLength(1);

    // Le second déclencheur (barre mobile) bascule le même état partagé : toujours un seul dialogue.
    await user.click(mobileTrigger);
    expect(screen.getAllByRole('dialog')).toHaveLength(1);
  });

  it('filtre les CV adaptes de cette offre, les plus recents en premier, avant de les passer au dialogue', async () => {
    fetchResumes.mockResolvedValue([
      makeResumeSummary({ id: 'resume-autre-offre', jobId: 'job-2', updatedAt: '2026-09-17T12:00:00.000Z' }),
      makeResumeSummary({ id: 'resume-ancien', jobId: 'job-1', updatedAt: '2026-09-01T00:00:00.000Z' }),
      makeResumeSummary({ id: 'resume-recent', jobId: 'job-1', updatedAt: '2026-09-16T00:00:00.000Z' }),
    ]);
    renderHeader(makeDetail({ id: 'job-1', application: null }));

    await waitFor(() => {
      const lastCall = applicationFormDialogSpy.mock.calls.at(-1)?.[0] as
        | { job: { tailoredResumes: { id: string }[] } }
        | undefined;
      expect(lastCall?.job.tailoredResumes.map((resume) => resume.id)).toEqual(['resume-recent', 'resume-ancien']);
    });
  });

  it('navigue vers la fiche existante quand le dialogue signale onOpenApplication (ex: doublon 409)', async () => {
    const user = userEvent.setup();
    renderHeaderWithProbe(makeDetail({ application: null }));

    const [inlineTrigger] = screen.getAllByRole('button', { name: 'Suivre cette candidature' });
    if (!inlineTrigger) throw new Error('Bouton "Suivre cette candidature" introuvable.');
    await user.click(inlineTrigger);

    await user.click(await screen.findByRole('button', { name: 'Ouvrir la fiche (test)' }));

    expect(screen.getByTestId('location-probe')).toHaveTextContent('/applications?candidature=app-existing');
  });

  it('affiche le libelle complet en ligne et le libelle compact Suivre dans la barre mobile (offre non suivie)', () => {
    renderHeader(makeDetail({ application: null }));

    expect(screen.getByText('Suivre cette candidature')).toBeInTheDocument();
    expect(screen.getByText('Suivre')).toBeInTheDocument();
    expect(screen.getAllByRole('button', { name: 'Suivre cette candidature' })).toHaveLength(2);
  });

  it('affiche le libelle complet avec statut en ligne et le libelle compact Suivie dans la barre mobile (offre suivie)', () => {
    renderHeader(makeDetail({ application: { id: 'app-1', status: 'INTERVIEW' } }));

    expect(screen.getByText('Candidature suivie · Entretien')).toBeInTheDocument();
    expect(screen.getByText('Suivie')).toBeInTheDocument();
    const links = screen.getAllByRole('link', { name: 'Candidature suivie · Entretien' });
    expect(links).toHaveLength(2);
    for (const link of links) expect(link).toHaveAttribute('href', '/applications?candidature=app-1');
  });
});
