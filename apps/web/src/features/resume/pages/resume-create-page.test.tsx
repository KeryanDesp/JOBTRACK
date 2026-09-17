import type { BaseResumeDto, JobDetailDto, MatchScoreDto, ResumeDto } from '@jobtrack/shared';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ApiError } from '@/services/api/client';
import { ResumeCreatePage } from './resume-create-page';

const fetchJob = vi.hoisted(() => vi.fn());
vi.mock('@/services/api/jobs', () => ({
  fetchJob,
  fetchJobsCapabilities: vi.fn(),
  fetchSavedJobs: vi.fn(),
  saveJob: vi.fn(),
  unsaveJob: vi.fn(),
  searchCommunes: vi.fn(),
  searchJobs: vi.fn(),
}));

const fetchJobMatch = vi.hoisted(() => vi.fn());
const analyzeJobs = vi.hoisted(() => vi.fn());
vi.mock('@/services/api/matching', () => ({
  fetchJobMatch,
  analyzeJobs,
  retryJobAnalysis: vi.fn(),
}));

const fetchBaseResume = vi.hoisted(() => vi.fn());
const tailorResume = vi.hoisted(() => vi.fn());
// `useResume(cvId)` (revue tâche 7 fixup point 3) revalide en arrière-plan dès qu'il devient
// actif (staleTime 0 par défaut dans ce client de test) : sans réponse par défaut, ce second
// appel à `fetchResume` résoudrait `undefined` et déclencherait l'avertissement React Query
// « Query data cannot be undefined » — jamais observable en production (l'API renvoie toujours
// un corps), donc simplement rejoué ici avec la même réponse que `tailorResume`.
const fetchResume = vi.hoisted(() => vi.fn());
vi.mock('@/services/api/resume', () => ({
  fetchBaseResume,
  updateResumeTemplate: vi.fn(),
  fetchResumes: vi.fn(),
  tailorResume,
  fetchResume,
  updateResume: vi.fn(),
  deleteResume: vi.fn(),
  fetchLetters: vi.fn(),
  createLetter: vi.fn(),
  fetchLetter: vi.fn(),
  updateLetter: vi.fn(),
  deleteLetter: vi.fn(),
}));

function makeJob(overrides: Partial<JobDetailDto> = {}): JobDetailDto {
  return {
    id: 'job-1',
    title: 'Développeuse React',
    company: 'Piloto Software',
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
    publishedAt: '2026-09-01T00:00:00.000Z',
    expiredAt: null,
    description: 'Description de l’offre.',
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
    lastSeenAt: '2026-09-01T00:00:00.000Z',
    skills: [],
    sources: [],
    requirements: [],
    saved: false,
    match: null,
    application: null,
    ...overrides,
  };
}

function makeMatch(overrides: Partial<MatchScoreDto> = {}): MatchScoreDto {
  return {
    score: null,
    band: null,
    priority: null,
    explanation: { top: [], weak: [] },
    factors: [],
    computedAt: null,
    analysis: { status: 'none', error: null },
    profileComplete: true,
    insufficientData: false,
    ...overrides,
  };
}

function makeBaseResume(overrides: Partial<BaseResumeDto> = {}): BaseResumeDto {
  return {
    template: 'CLASSIC',
    profileComplete: true,
    content: {
      schemaVersion: 1,
      identity: { firstName: 'Alice', lastName: 'Martin', title: null },
      summary: 'Résumé du profil.',
      experiences: [
        {
          id: 'exp-1',
          company: 'Acme',
          role: 'Développeuse',
          location: null,
          startDate: '2022-01-01',
          endDate: null,
          isCurrent: true,
          highlights: ['A construit une plateforme.'],
          sourceDescription: null,
        },
        {
          id: 'exp-2',
          company: 'Beta',
          role: 'Stagiaire',
          location: null,
          startDate: '2020-01-01',
          endDate: '2020-06-01',
          isCurrent: false,
          highlights: ['A développé un prototype.'],
          sourceDescription: null,
        },
      ],
      educations: [],
      skills: [],
      languages: [],
      certifications: [],
      projects: [],
    },
    ...overrides,
  };
}

function makeTailoredResume(overrides: Partial<ResumeDto> = {}): ResumeDto {
  const baseContent = makeBaseResume().content;
  const keptExperience = baseContent.experiences.find((item) => item.id === 'exp-1');
  return {
    id: 'resume-1',
    title: 'CV Développeuse React — Piloto Software',
    jobId: 'job-1',
    jobTitle: 'Développeuse React',
    company: 'Piloto Software',
    template: 'CLASSIC',
    currentVersion: 1,
    createdAt: '2026-09-01T00:00:00.000Z',
    updatedAt: '2026-09-01T00:00:00.000Z',
    content: { ...baseContent, experiences: keptExperience ? [keptExperience] : [] },
    changes: {
      title: { before: '', after: 'Développeuse React confirmée' },
      summary: { before: 'Résumé du profil.', after: 'Résumé adapté à l’offre.' },
      experiences: [
        { id: 'exp-1', before: ['A construit une plateforme.'], after: ['A construit une plateforme React.'], kept: true, rejected: [] },
        { id: 'exp-2', before: ['A développé un prototype.'], after: [], kept: false, rejected: [] },
      ],
      skills: { before: [], after: [] },
      educations: { kept: [], removed: [] },
      certifications: { kept: [], removed: [] },
      projects: { kept: [], removed: [] },
      notes: null,
    },
    version: { number: 1, source: 'AI', model: 'claude', promptVersion: 1, createdAt: '2026-09-01T00:00:00.000Z' },
    ...overrides,
  };
}

afterEach(() => {
  fetchJob.mockReset();
  fetchJobMatch.mockReset();
  analyzeJobs.mockReset();
  fetchBaseResume.mockReset();
  tailorResume.mockReset();
  fetchResume.mockReset();
});

function LocationSearchProbe() {
  const location = useLocation();
  return <div data-testid="location-search">{location.search}</div>;
}

function renderAtStep(step: string) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={client}>
      <MemoryRouter initialEntries={[`/resume/create/job-1?etape=${step}`]}>
        <Routes>
          <Route path="/resume/create/:jobId" element={<ResumeCreatePage />} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

describe('ResumeCreatePage', () => {
  it("reflete l_etape courante dans l_URL et avance en cliquant sur Continuer sans analyse", async () => {
    fetchJob.mockResolvedValue(makeJob());
    fetchJobMatch.mockResolvedValue(makeMatch());
    fetchBaseResume.mockResolvedValue(makeBaseResume());
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const user = userEvent.setup();
    render(
      <QueryClientProvider client={client}>
        <MemoryRouter initialEntries={['/resume/create/job-1']}>
          <Routes>
            <Route
              path="/resume/create/:jobId"
              element={
                <>
                  <ResumeCreatePage />
                  <LocationSearchProbe />
                </>
              }
            />
          </Routes>
        </MemoryRouter>
      </QueryClientProvider>,
    );

    await screen.findByRole('heading', { name: 'Générer un CV adapté' });
    expect(screen.getByTestId('location-search')).toHaveTextContent('');

    await user.click(screen.getByRole('button', { name: 'Continuer sans analyse' }));

    await waitFor(() => expect(screen.getByTestId('location-search')).toHaveTextContent('?etape=selection'));
    expect(await screen.findByRole('button', { name: 'Adapter mon CV' })).toBeInTheDocument();
  });

  it("Adapter mon CV appelle tailorResume et affiche les changements avant/apres", async () => {
    fetchJob.mockResolvedValue(makeJob());
    fetchJobMatch.mockResolvedValue(makeMatch());
    fetchBaseResume.mockResolvedValue(makeBaseResume());
    tailorResume.mockResolvedValue(makeTailoredResume());
    fetchResume.mockResolvedValue(makeTailoredResume());
    const user = userEvent.setup();
    renderAtStep('selection');

    await user.click(await screen.findByRole('button', { name: 'Adapter mon CV' }));

    await waitFor(() => expect(tailorResume).toHaveBeenCalledWith({ jobId: 'job-1', template: 'CLASSIC' }));
    expect(await screen.findByText('Développeuse React confirmée')).toBeInTheDocument();
    expect(screen.getByText('A construit une plateforme React.')).toBeInTheDocument();
  });

  it("Retablir restaure une experience ecartee par l_IA avec les puces de la base (after vide cote serveur)", async () => {
    fetchJob.mockResolvedValue(makeJob());
    fetchJobMatch.mockResolvedValue(makeMatch());
    fetchBaseResume.mockResolvedValue(makeBaseResume());
    tailorResume.mockResolvedValue(makeTailoredResume());
    fetchResume.mockResolvedValue(makeTailoredResume());
    const user = userEvent.setup();
    renderAtStep('selection');

    await user.click(await screen.findByRole('button', { name: 'Adapter mon CV' }));
    await screen.findByText('Écartée');

    await user.click(screen.getByRole('button', { name: "Rétablir l'expérience Stagiaire — Beta" }));

    // Rétablie : l'expérience réapparaît à la fois dans « Modifications » (désormais
    // « Conservée ») et dans l'éditeur — deux occurrences, jamais une erreur.
    expect((await screen.findAllByText(/stagiaire/i)).length).toBeGreaterThan(0);
    // `after` est vide côté serveur pour une expérience écartée (revue, point 1) : la
    // puce rétablie dans l'éditeur doit venir de la base, jamais rester vide.
    expect(await screen.findByDisplayValue('A développé un prototype.')).toBeInTheDocument();
  });

  it("affiche l_etat IA non configuree quand l_adaptation echoue avec ce code", async () => {
    fetchJob.mockResolvedValue(makeJob());
    fetchJobMatch.mockResolvedValue(makeMatch());
    fetchBaseResume.mockResolvedValue(makeBaseResume());
    tailorResume.mockRejectedValue(new ApiError("Le service IA n'est pas configuré.", 503, 'AI_NOT_CONFIGURED'));
    const user = userEvent.setup();
    renderAtStep('selection');

    await user.click(await screen.findByRole('button', { name: 'Adapter mon CV' }));

    expect(await screen.findByText("Le service IA n'est pas configuré.")).toBeInTheDocument();
  });
});
