import type { AnalyzeJobsResponseDto, JobListResponseDto, JobSummaryDto } from '@jobtrack/shared';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom';
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import type * as JobsApi from '@/services/api/jobs';
import type * as ProfileApi from '@/services/api/profile';
import type { PreferencesDto } from '@/services/api/profile';
import { JobsPage } from './jobs-page';

const searchJobs = vi.hoisted(() => vi.fn());
const searchCommunes = vi.hoisted(() => vi.fn());
const fetchJobsCapabilities = vi.hoisted(() => vi.fn());

vi.mock('@/services/api/jobs', async () => {
  const actual = await vi.importActual<typeof JobsApi>('@/services/api/jobs');
  return {
    ...actual,
    searchJobs,
    searchCommunes,
    fetchJobsCapabilities,
    saveJob: vi.fn(),
    unsaveJob: vi.fn(),
    fetchJob: vi.fn(),
    fetchSavedJobs: vi.fn(),
  };
});

const fetchPreferences = vi.hoisted(() => vi.fn());
vi.mock('@/services/api/profile', async () => {
  const actual = await vi.importActual<typeof ProfileApi>('@/services/api/profile');
  return { ...actual, fetchPreferences };
});

const analyzeJobsApi = vi.hoisted(() => vi.fn());
const fetchJobMatch = vi.hoisted(() => vi.fn());
const retryJobAnalysis = vi.hoisted(() => vi.fn());

vi.mock('@/services/api/matching', () => ({
  analyzeJobs: analyzeJobsApi,
  fetchJobMatch,
  retryJobAnalysis,
}));

function makeAnalyzeResponse(overrides: Partial<AnalyzeJobsResponseDto> = {}): AnalyzeJobsResponseDto {
  return { analyzed: 0, pending: 0, failed: 0, notConfigured: false, profileComplete: true, scores: {}, ...overrides };
}

// jsdom n'implémente pas `window.scrollTo` (spec §7 : retour en haut de page au
// changement de pagination) : sans ce stub, chaque appel logge une erreur « not
// implemented » bruyante mais inoffensive. Idem `scrollIntoView` (Radix Select,
// `JobSortSelect`), appelé à l'ouverture du menu pour faire défiler l'option active en vue.
beforeAll(() => {
  window.scrollTo = vi.fn();
  Element.prototype.scrollIntoView = vi.fn();
});

// Résolu par défaut à `true` : la plupart des tests ne portent pas sur le bandeau
// « connecteur non configuré » et ne doivent pas avoir à s'en soucier ; ceux qui le
// testent explicitement (`franceTravail: false`) l'écrasent avant `renderPage`.
// `analyzeJobsApi` : réponse par défaut « tout va bien » (rien à analyser côté
// serveur, IA configurée, profil complet) — les tests dédiés au score
// (analyse déclenchée, bandeau IA non configurée, profil incomplet...)
// l'écrasent explicitement.
beforeEach(() => {
  fetchJobsCapabilities.mockResolvedValue({ sources: { franceTravail: true } });
  analyzeJobsApi.mockResolvedValue(makeAnalyzeResponse());
});

afterEach(() => {
  searchJobs.mockReset();
  searchCommunes.mockReset();
  fetchPreferences.mockReset();
  fetchJobsCapabilities.mockReset();
  analyzeJobsApi.mockReset();
  fetchJobMatch.mockReset();
  retryJobAnalysis.mockReset();
});

const EMPTY_PREFS: PreferencesDto = {
  id: 'pref1',
  desiredRoles: [],
  desiredCategories: [],
  salaryMin: null,
  salaryMax: null,
  currency: 'EUR',
  locations: [],
  searchRadiusKm: 10,
  remoteModes: [],
  contractTypes: [],
  availability: null,
  experienceLevel: null,
};

function makeSummary(overrides: Partial<JobSummaryDto> = {}): JobSummaryDto {
  return {
    id: 'job-1',
    title: 'Développeur',
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
    match: null,
    ...overrides,
  };
}

function makeList(overrides: Partial<JobListResponseDto> = {}): JobListResponseDto {
  return {
    items: [],
    total: 0,
    page: 1,
    pageSize: 20,
    sync: { status: 'ok', syncedAt: null, message: null, analysis: { analyzed: 0, total: 0, notConfigured: false } },
    ...overrides,
  };
}

/** Sonde de l'URL courante (spec §6/§8 : onglet/tri encodés dans l'URL), `MemoryRouter` ne
 * synchronisant jamais `window.location` — seul `useLocation` reflète fidèlement son état. */
function LocationProbe() {
  const location = useLocation();
  return <div data-testid="location">{`${location.pathname}${location.search}`}</div>;
}

function renderPage(initialEntry: string) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={client}>
      <MemoryRouter initialEntries={[initialEntry]}>
        <LocationProbe />
        <Routes>
          <Route path="/jobs" element={<JobsPage />} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

describe('JobsPage', () => {
  it('reprend les preferences (poste, lieu, rayon) dans l_URL a la premiere visite', async () => {
    fetchPreferences.mockResolvedValue({
      ...EMPTY_PREFS,
      desiredRoles: ['Développeuse'],
      locations: ['Metz'],
      searchRadiusKm: 25,
    });
    searchCommunes.mockResolvedValue([{ code: '57463', name: 'Metz', postalCode: '57000', departmentCode: '57' }]);
    searchJobs.mockResolvedValue(makeList());

    renderPage('/jobs');

    await waitFor(() => {
      expect(searchJobs).toHaveBeenCalledWith(
        expect.objectContaining({ q: 'Développeuse', communes: ['57463'], distance: 25 }),
      );
    });
    expect(await screen.findByText('Metz')).toBeInTheDocument();
  });

  it('ne touche pas a l_URL quand elle porte deja des criteres (lien partage)', async () => {
    fetchPreferences.mockResolvedValue({ ...EMPTY_PREFS, desiredRoles: ['Ignoré'], locations: ['Paris'] });
    searchJobs.mockResolvedValue(makeList());

    renderPage('/jobs?q=comptable');

    await waitFor(() => expect(searchJobs).toHaveBeenCalledWith(expect.objectContaining({ q: 'comptable' })));
    expect(searchJobs).not.toHaveBeenCalledWith(expect.objectContaining({ q: 'Ignoré' }));
  });

  it('un changement de filtre reecrit l_URL et remet la page a 1', async () => {
    fetchPreferences.mockResolvedValue(EMPTY_PREFS);
    searchJobs.mockResolvedValue(makeList({ page: 3 }));

    renderPage('/jobs?page=3');
    await waitFor(() => expect(searchJobs).toHaveBeenCalledWith(expect.objectContaining({ page: 3 })));

    const user = userEvent.setup();
    await user.click(await screen.findByRole('button', { name: 'Contrat' }));
    await user.click(await screen.findByText('CDI'));

    await waitFor(() => {
      expect(searchJobs).toHaveBeenCalledWith(expect.objectContaining({ contractTypes: ['CDI'], page: 1 }));
    });
  });

  it('affiche le bandeau connecteur non configure', async () => {
    fetchPreferences.mockResolvedValue(EMPTY_PREFS);
    searchJobs.mockResolvedValue(makeList({ sync: { status: 'not_configured', syncedAt: null, message: null, analysis: { analyzed: 0, total: 0, notConfigured: true } } }));

    renderPage('/jobs');

    expect(await screen.findByText(/n'est pas configuré/)).toBeInTheDocument();
  });

  it('affiche le bandeau degrade quand France Travail ne repond pas', async () => {
    fetchPreferences.mockResolvedValue(EMPTY_PREFS);
    searchJobs.mockResolvedValue(makeList({ sync: { status: 'degraded', syncedAt: null, message: null, analysis: { analyzed: 0, total: 0, notConfigured: false } } }));

    renderPage('/jobs');

    expect(await screen.findByText(/France Travail ne répond pas\./)).toBeInTheDocument();
  });

  it('affiche l_etat vide sans bouton de reinitialisation quand aucun filtre n_est actif', async () => {
    fetchPreferences.mockResolvedValue(EMPTY_PREFS);
    searchJobs.mockResolvedValue(makeList({ items: [], total: 0 }));

    renderPage('/jobs');

    expect(await screen.findByText('Aucune offre ne correspond.')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Réinitialiser les filtres' })).not.toBeInTheDocument();
  });

  it('affiche le bouton de reinitialisation dans l_etat vide quand un filtre est actif', async () => {
    fetchPreferences.mockResolvedValue(EMPTY_PREFS);
    searchJobs.mockResolvedValue(makeList({ items: [], total: 0 }));

    renderPage('/jobs?contrat=CDI');

    expect(await screen.findByText('Aucune offre ne correspond.')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Réinitialiser les filtres' })).toBeInTheDocument();
  });

  it('la pagination navigue vers la page 2', async () => {
    fetchPreferences.mockResolvedValue(EMPTY_PREFS);
    searchJobs.mockResolvedValue(makeList({ items: [makeSummary()], total: 45, page: 1 }));

    renderPage('/jobs');
    await screen.findByText('45 offres trouvées · 0 analysées');

    const user = userEvent.setup();
    await user.click(screen.getByRole('link', { name: '2' }));

    await waitFor(() => expect(searchJobs).toHaveBeenCalledWith(expect.objectContaining({ page: 2 })));
  });

  it('ramene un rayon de preference hors bornes a l_option de rayon la plus proche', async () => {
    fetchPreferences.mockResolvedValue({ ...EMPTY_PREFS, desiredRoles: ['Développeuse'], searchRadiusKm: 200 });
    searchJobs.mockResolvedValue(makeList());

    renderPage('/jobs');

    await waitFor(() => expect(searchJobs).toHaveBeenCalledWith(expect.objectContaining({ distance: 100 })));
  });

  it('affiche immediatement le bandeau non configure grace aux capacites, avant toute reponse de recherche', async () => {
    fetchPreferences.mockResolvedValue(EMPTY_PREFS);
    fetchJobsCapabilities.mockResolvedValue({ sources: { franceTravail: false } });
    // Jamais résolue : la recherche elle-même n'a donc pas encore de `sync.status`
    // à afficher — seul `useJobsCapabilities` peut annoncer le bandeau ici.
    searchJobs.mockReturnValue(new Promise<JobListResponseDto>(() => {}));

    renderPage('/jobs');

    expect(await screen.findByText(/n'est pas configuré/)).toBeInTheDocument();
  });

  it('affiche un repli lisible pour une commune de l_URL non encore resolue', async () => {
    fetchPreferences.mockResolvedValue(EMPTY_PREFS);
    searchJobs.mockResolvedValue(makeList());

    renderPage('/jobs?lieu=57463');

    expect(await screen.findByText('Code INSEE 57463')).toBeInTheDocument();
  });

  it('active les onglets/tris et met a jour l_URL (onglet=pour-vous, tri=match)', async () => {
    fetchPreferences.mockResolvedValue(EMPTY_PREFS);
    searchJobs.mockResolvedValue(makeList());
    const user = userEvent.setup();

    renderPage('/jobs');
    await waitFor(() => expect(searchJobs).toHaveBeenCalled());

    await user.click(screen.getByRole('tab', { name: 'Pour vous' }));
    await waitFor(() => expect(screen.getByTestId('location')).toHaveTextContent('onglet=pour-vous'));

    await user.click(screen.getByRole('combobox', { name: 'Trier par' }));
    await user.click(screen.getByRole('option', { name: 'Meilleur match' }));
    await waitFor(() => expect(screen.getByTestId('location')).toHaveTextContent('tri=match'));
  });

  it('declenche analyze une fois avec les ids sans match, jamais a nouveau sur les memes donnees', async () => {
    fetchPreferences.mockResolvedValue(EMPTY_PREFS);
    // Deux objets distincts (spec §7 : la garde doit porter sur le jeu d'ids, pas sur une
    // simple égalité de référence) mais aux mêmes offres, toujours sans score.
    searchJobs
      .mockResolvedValueOnce(makeList({ items: [makeSummary({ id: 'job-1' }), makeSummary({ id: 'job-2' })], total: 2 }))
      .mockResolvedValue(makeList({ items: [makeSummary({ id: 'job-1' }), makeSummary({ id: 'job-2' })], total: 2 }));
    // Profil incomplet : neutralise la bascule « Pertinence par défaut » (hors sujet ici),
    // qui provoquerait sinon une recherche supplémentaire (changement de tri) confondue avec
    // la réactualisation manuelle ci-dessous.
    analyzeJobsApi.mockResolvedValue(makeAnalyzeResponse({ profileComplete: false }));

    renderPage('/jobs');

    await waitFor(() => expect(analyzeJobsApi).toHaveBeenCalledWith(['job-1', 'job-2']));
    expect(analyzeJobsApi).toHaveBeenCalledTimes(1);

    // Reactualisation manuelle (spec §7 : « pas en boucle ») : mêmes offres, toujours sans
    // score (réponse par défaut du `beforeEach`, `scores: {}`) — l'analyse ne doit pas repartir.
    const user = userEvent.setup();
    await user.click(await screen.findByRole('button', { name: 'Actualiser' }));
    await waitFor(() => expect(searchJobs).toHaveBeenCalledTimes(2));

    expect(analyzeJobsApi).toHaveBeenCalledTimes(1);
  });

  it('affiche la progression tant que des offres restent en cours d_analyse', async () => {
    fetchPreferences.mockResolvedValue(EMPTY_PREFS);
    searchJobs.mockResolvedValue(
      makeList({ items: [makeSummary({ id: 'job-1' }), makeSummary({ id: 'job-2' })], total: 2 }),
    );
    analyzeJobsApi.mockResolvedValue(
      makeAnalyzeResponse({
        analyzed: 1,
        pending: 1,
        scores: { 'job-1': { score: 80, band: 'GOOD', priority: 'GOOD', explanation: { top: [], weak: [] } } },
      }),
    );

    renderPage('/jobs');

    expect(await screen.findByText(/Analyse de 1 offre…/)).toBeInTheDocument();
  });

  it('affiche une seule fois le bandeau IA non configuree, sous la banniere de synchro', async () => {
    fetchPreferences.mockResolvedValue(EMPTY_PREFS);
    searchJobs.mockResolvedValue(
      makeList({ items: [makeSummary({ id: 'job-1' }), makeSummary({ id: 'job-2' })], total: 2 }),
    );
    analyzeJobsApi.mockResolvedValue(makeAnalyzeResponse({ notConfigured: true }));

    renderPage('/jobs');

    expect(
      await screen.findAllByText("L'analyse des offres nécessite le service IA (non configuré)."),
    ).toHaveLength(1);
  });

  it('affiche le bandeau profil incomplet quand le profil n_est pas complet', async () => {
    fetchPreferences.mockResolvedValue(EMPTY_PREFS);
    searchJobs.mockResolvedValue(makeList({ items: [makeSummary({ id: 'job-1' })], total: 1 }));
    analyzeJobsApi.mockResolvedValue(makeAnalyzeResponse({ profileComplete: false }));

    renderPage('/jobs');

    expect(
      await screen.findByText('Complétez vos compétences et expériences pour obtenir un score fiable.'),
    ).toBeInTheDocument();
  });

  it('bascule le tri par defaut sur Pertinence quand l_IA est configuree et le profil complet', async () => {
    fetchPreferences.mockResolvedValue(EMPTY_PREFS);
    searchJobs.mockResolvedValue(makeList({ items: [makeSummary({ id: 'job-1' })], total: 1 }));
    // Réponse par défaut du `beforeEach` : IA configurée, profil complet.

    renderPage('/jobs');

    await waitFor(() => expect(screen.getByTestId('location')).toHaveTextContent('tri=pertinence'));
  });

  it('garde Plus recentes par defaut quand l_IA n_est pas configuree', async () => {
    fetchPreferences.mockResolvedValue(EMPTY_PREFS);
    searchJobs.mockResolvedValue(makeList({ items: [makeSummary({ id: 'job-1' })], total: 1 }));
    analyzeJobsApi.mockResolvedValue(makeAnalyzeResponse({ notConfigured: true }));

    renderPage('/jobs');

    await screen.findByText("L'analyse des offres nécessite le service IA (non configuré).");
    expect(screen.getByTestId('location')).not.toHaveTextContent('tri=');
  });

  it('bascule le tri par defaut sans attendre l_analyse quand toutes les offres sont deja notees (chemin rapide)', async () => {
    fetchPreferences.mockResolvedValue(EMPTY_PREFS);
    searchJobs.mockResolvedValue(
      makeList({
        items: [
          makeSummary({
            id: 'job-1',
            match: { score: 80, band: 'GOOD', priority: 'GOOD', explanation: { top: [], weak: [] } },
          }),
        ],
        total: 1,
      }),
    );

    renderPage('/jobs');

    await waitFor(() => expect(screen.getByTestId('location')).toHaveTextContent('tri=pertinence'));
    // Aucune offre à analyser (toutes déjà notées) : le chemin rapide n'a pas eu besoin
    // d'attendre une réponse de `POST /jobs/analyses` pour connaître le profil/l'IA.
    expect(analyzeJobsApi).not.toHaveBeenCalled();
  });

  it('applique la reprise des preferences et la bascule Pertinence toutes les deux', async () => {
    fetchPreferences.mockResolvedValue({ ...EMPTY_PREFS, desiredRoles: ['Développeuse'], locations: ['Metz'] });
    searchCommunes.mockResolvedValue([{ code: '57463', name: 'Metz', postalCode: '57000', departmentCode: '57' }]);
    searchJobs.mockResolvedValue(
      makeList({
        items: [
          makeSummary({
            id: 'job-1',
            match: { score: 80, band: 'GOOD', priority: 'GOOD', explanation: { top: [], weak: [] } },
          }),
        ],
        total: 1,
      }),
    );

    renderPage('/jobs');

    await waitFor(() => expect(searchJobs).toHaveBeenCalledWith(expect.objectContaining({ q: 'Développeuse' })));
    await waitFor(() => expect(screen.getByTestId('location')).toHaveTextContent('tri=pertinence'));
  });

  it('conserve un tri explicite (tri=match) meme quand l_IA est configuree et le profil complet', async () => {
    fetchPreferences.mockResolvedValue(EMPTY_PREFS);
    searchJobs.mockResolvedValue(makeList({ items: [makeSummary({ id: 'job-1' })], total: 1 }));
    // Réponse par défaut du `beforeEach` : IA configurée, profil complet — les conditions de la
    // bascule automatique sont réunies, mais un tri déjà choisi explicitement dans l'URL au
    // chargement (mémorisé une fois pour toutes au montage) ne doit jamais être écrasé.

    renderPage('/jobs?tri=match');

    await waitFor(() => expect(analyzeJobsApi).toHaveBeenCalled());
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(screen.getByTestId('location')).toHaveTextContent('tri=match');
  });

  it(
    'la barre de progression disparait une fois toutes les offres analysees',
    async () => {
      fetchPreferences.mockResolvedValue(EMPTY_PREFS);
      searchJobs.mockResolvedValue(makeList({ items: [makeSummary({ id: 'job-1' })], total: 1 }));
      // Le premier sondage revient encore `pending`, le second confirme l'offre analysée
      // (`useAnalysisPolling` : spec §2/§7, revue point 1 — re-sonde toutes les 2 s).
      analyzeJobsApi
        .mockResolvedValueOnce(makeAnalyzeResponse({ pending: 1 }))
        .mockResolvedValueOnce(
          makeAnalyzeResponse({
            analyzed: 1,
            pending: 0,
            scores: { 'job-1': { score: 80, band: 'GOOD', priority: 'GOOD', explanation: { top: [], weak: [] } } },
          }),
        );

      renderPage('/jobs');

      expect(await screen.findByText(/Analyse de 1 offre…/)).toBeInTheDocument();
      await waitFor(() => expect(screen.queryByText(/Analyse de 1 offre…/)).not.toBeInTheDocument(), {
        timeout: 5_000,
      });
    },
    8_000,
  );

  it('garde les bandeaux IA/profil visibles sur Forte priorite meme a 0 resultat', async () => {
    fetchPreferences.mockResolvedValue(EMPTY_PREFS);
    // Premier chargement (onglet « Toutes ») : apprend « IA non configurée » via l'analyse.
    searchJobs.mockResolvedValueOnce(makeList({ items: [makeSummary({ id: 'job-1' })], total: 1 }));
    analyzeJobsApi.mockResolvedValue(makeAnalyzeResponse({ notConfigured: true }));

    renderPage('/jobs');

    await screen.findByText("L'analyse des offres nécessite le service IA (non configuré).");

    // Bascule vers « Forte priorité » : 0 résultat, donc aucune nouvelle analyse déclenchée —
    // mais le bandeau déjà appris doit rester visible (état hissé au niveau page, revue point 4).
    searchJobs.mockResolvedValue(makeList({ items: [], total: 0 }));
    const user = userEvent.setup();
    await user.click(screen.getByRole('tab', { name: 'Forte priorité' }));

    await waitFor(() => expect(screen.getByTestId('location')).toHaveTextContent('onglet=priorite'));
    expect(screen.getByText("L'analyse des offres nécessite le service IA (non configuré).")).toBeInTheDocument();
  });
});
