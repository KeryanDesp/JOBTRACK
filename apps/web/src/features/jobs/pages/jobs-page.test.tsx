import type { JobListResponseDto, JobSummaryDto } from '@jobtrack/shared';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
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

// jsdom n'implémente pas `window.scrollTo` (spec §7 : retour en haut de page au
// changement de pagination) : sans ce stub, chaque appel logge une erreur « not
// implemented » bruyante mais inoffensive.
beforeAll(() => {
  window.scrollTo = vi.fn();
});

// Résolu par défaut à `true` : la plupart des tests ne portent pas sur le bandeau
// « connecteur non configuré » et ne doivent pas avoir à s'en soucier ; ceux qui le
// testent explicitement (`franceTravail: false`) l'écrasent avant `renderPage`.
beforeEach(() => {
  fetchJobsCapabilities.mockResolvedValue({ sources: { franceTravail: true } });
});

afterEach(() => {
  searchJobs.mockReset();
  searchCommunes.mockReset();
  fetchPreferences.mockReset();
  fetchJobsCapabilities.mockReset();
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

function renderPage(initialEntry: string) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={client}>
      <MemoryRouter initialEntries={[initialEntry]}>
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
    searchJobs.mockResolvedValue(makeList({ sync: { status: 'not_configured', syncedAt: null, message: null } }));

    renderPage('/jobs');

    expect(await screen.findByText(/n'est pas configuré/)).toBeInTheDocument();
  });

  it('affiche le bandeau degrade quand France Travail ne repond pas', async () => {
    fetchPreferences.mockResolvedValue(EMPTY_PREFS);
    searchJobs.mockResolvedValue(makeList({ sync: { status: 'degraded', syncedAt: null, message: null } }));

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
    await screen.findByText('45 offres trouvées dans votre zone de recherche.');

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
});
