import type { JobDetailDto, MatchScoreDto } from '@jobtrack/shared';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ApiError } from '@/services/api/client';
import { JobDetailPage } from './job-detail-page';

const fetchJob = vi.hoisted(() => vi.fn());
const saveJob = vi.hoisted(() => vi.fn());
const unsaveJob = vi.hoisted(() => vi.fn());

vi.mock('@/services/api/jobs', () => ({
  fetchJob,
  saveJob,
  unsaveJob,
  fetchJobsCapabilities: vi.fn(),
  fetchSavedJobs: vi.fn(),
  searchCommunes: vi.fn(),
  searchJobs: vi.fn(),
}));

const fetchJobMatch = vi.hoisted(() => vi.fn());
const analyzeJobs = vi.hoisted(() => vi.fn());
const retryJobAnalysis = vi.hoisted(() => vi.fn());

vi.mock('@/services/api/matching', () => ({
  fetchJobMatch,
  analyzeJobs,
  retryJobAnalysis,
}));

function makeMatchScore(overrides: Partial<MatchScoreDto> = {}): MatchScoreDto {
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

// Repli par défaut (spec §2/§7) : offre pas encore analysée, aucune mutation en
// cours — les tests qui ne portent pas sur le score n'ont pas à s'en soucier.
beforeEach(() => {
  fetchJobMatch.mockResolvedValue(makeMatchScore());
});

afterEach(() => {
  fetchJob.mockReset();
  saveJob.mockReset();
  unsaveJob.mockReset();
  fetchJobMatch.mockReset();
  analyzeJobs.mockReset();
  retryJobAnalysis.mockReset();
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
    match: null,
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

  it('affiche un message d_offre introuvable avec un lien de retour, sans bouton reessayer, sur une 404', async () => {
    fetchJob.mockRejectedValue(new ApiError('Offre introuvable.', 404));
    renderPage();

    expect(await screen.findByText('Offre introuvable.')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Retour aux offres' })).toHaveAttribute('href', '/jobs');
    expect(screen.queryByRole('button', { name: 'Réessayer' })).not.toBeInTheDocument();
  });

  it('garde le bouton reessayer pour une erreur autre qu_une 404', async () => {
    fetchJob.mockRejectedValue(new ApiError('Panne serveur.', 500));
    renderPage();

    expect(await screen.findByText("Impossible de charger l'offre. Réessayez.")).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Réessayer' })).toBeInTheDocument();
    expect(screen.queryByRole('link', { name: 'Retour aux offres' })).not.toBeInTheDocument();
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
    expect(showMore).toHaveAttribute('aria-expanded', 'false');
    const textId = showMore.getAttribute('aria-controls');
    expect(textId).toBeTruthy();
    expect(document.getElementById(textId ?? '')).toHaveTextContent(/…$/);

    const user = userEvent.setup();
    await user.click(showMore);

    const showLess = screen.getByRole('button', { name: 'Voir moins' });
    expect(showLess).toHaveAttribute('aria-expanded', 'true');
    expect(showLess).toHaveAttribute('aria-controls', textId);
    expect(screen.getByText(longDescription.trim())).toBeInTheDocument();
  });

  it('bascule sauvegarder/retirer depuis le detail', async () => {
    saveJob.mockResolvedValue(undefined);
    // `useSaveJob` invalide et refait la requête du détail une fois la mutation réglée (spec
    // §7, « vérité serveur ») : un vrai serveur renverrait `saved: true` après la sauvegarde,
    // d'où le second mock — sans lui, ce test figerait `fetchJob` sur sa réponse initiale et
    // cette re-synchronisation écraserait la mise à jour optimiste qu'on veut vérifier.
    fetchJob.mockResolvedValueOnce(makeDetail({ saved: false })).mockResolvedValue(makeDetail({ saved: true }));
    const user = userEvent.setup();
    renderPage();

    await screen.findByRole('heading', { name: 'Développeuse full-stack' });
    const [saveButton] = screen.getAllByRole('button', { name: 'Sauvegarder' });
    if (!saveButton) throw new Error('Bouton "Sauvegarder" introuvable.');

    await user.click(saveButton);

    await waitFor(() => {
      expect(screen.getAllByRole('button', { name: 'Retirer des favoris' })[0]).toHaveAttribute('aria-pressed', 'true');
    });
    expect(saveJob).toHaveBeenCalledWith('job-1');
  });

  it('affiche le MatchPanel sous l_en_tete quand l_offre n_est pas encore analysee', async () => {
    fetchJob.mockResolvedValue(makeDetail());
    renderPage();

    expect(await screen.findByText('Pourquoi cette offre vous correspond')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Analyser cette offre' })).toBeInTheDocument();
  });

  it('declenche l_analyse en cliquant sur Analyser cette offre, qui relit le score (invalidation)', async () => {
    fetchJob.mockResolvedValue(makeDetail());
    // `useAnalyzeJobs` invalide `matchKeys.detail(id)` à la réussite (fixup f6959f9) : la
    // requête active se relit donc automatiquement, sans `.refetch()` explicite côté page —
    // d'où le second `fetchJobMatch` déclenché par l'invalidation plutôt que par le composant.
    fetchJobMatch
      .mockResolvedValueOnce(makeMatchScore())
      .mockResolvedValueOnce(
        makeMatchScore({
          score: 80,
          band: 'GOOD',
          priority: 'GOOD',
          analysis: { status: 'done', error: null },
          factors: [],
        }),
      );
    analyzeJobs.mockResolvedValue({
      analyzed: 1,
      pending: 0,
      failed: 0,
      notConfigured: false,
      profileComplete: true,
      scores: { 'job-1': { score: 80, band: 'GOOD', priority: 'GOOD', explanation: { top: [], weak: [] } } },
    });
    const user = userEvent.setup();
    renderPage();

    await user.click(await screen.findByRole('button', { name: 'Analyser cette offre' }));

    expect(analyzeJobs).toHaveBeenCalledWith(['job-1']);
    await waitFor(() => expect(fetchJobMatch).toHaveBeenCalledTimes(2));
    expect(await screen.findByText('Bonne correspondance · 80')).toBeInTheDocument();
  });

  it('affiche les liens vers l_adaptation du CV et la generation d_une lettre', async () => {
    fetchJob.mockResolvedValue(makeDetail());
    renderPage();

    await screen.findByRole('heading', { name: 'Développeuse full-stack' });

    expect(screen.getByRole('link', { name: 'Adapter mon CV' })).toHaveAttribute('href', '/resume/create/job-1');
    expect(screen.getByRole('link', { name: 'Générer une lettre' })).toHaveAttribute('href', '/resume/letter/job-1');
  });

  it('affiche une alerte avec le message serveur quand Analyser cette offre echoue (429)', async () => {
    fetchJob.mockResolvedValue(makeDetail());
    analyzeJobs.mockRejectedValue(new ApiError('Trop de requêtes.', 429, 'RATE_LIMITED'));
    const user = userEvent.setup();
    renderPage();

    await user.click(await screen.findByRole('button', { name: 'Analyser cette offre' }));

    expect(await screen.findByText('Trop de requêtes.')).toBeInTheDocument();
  });
});
