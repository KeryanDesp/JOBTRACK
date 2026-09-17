import { expect, test, type Cookie, type Page } from '@playwright/test';

/**
 * Tâche 9 (spec §9, plan tâche 9) : recette Playwright du score de correspondance
 * *sans IA* — sur cette machine, `ANTHROPIC_API_KEY` est absente, donc toute
 * analyse répond `AI_NOT_CONFIGURED` (503) une fois `POST /jobs/analyses`
 * disponible. Cette route (tâche 6) est développée en parallèle de cette suite :
 * chaque test sonde son état réel via l'API avant d'affirmer un texte précis, et
 * se contente d'un contrôle « ça ne plante pas » avec une annotation si elle
 * répond encore 404 au moment de l'exécution — jamais un score inventé, jamais
 * une assertion qui suppose à tort que la tâche 6 est terminée.
 */

const API_BASE = 'http://localhost:3001/api/v1';

// Même suffixe et même nettoyage que les autres specs
// (`apps/api/scripts/cleanup-e2e-users.ts`) : jamais un vrai domaine.
function uniqueEmail(): string {
  return `e2e-${Date.now()}-${Math.random().toString(36).slice(2)}@playwright.local`;
}

const PASSWORD = 'MotDePasseSolide-2026-e2e';

/** Une offre a été trouvée ou non (spec §2/§7) : les deux formes possibles du sous-titre. */
const RESULT_SUBTITLE = /offres?\s+trouvées?/;

const NOT_CONFIGURED_MESSAGE = "L'analyse des offres nécessite le service IA (non configuré).";
const INCOMPLETE_PROFILE_MESSAGE = 'Complétez vos compétences et expériences pour obtenir un score fiable.';

// Un seul compte pour tout le fichier (limite d'inscription 20/h/IP, spec tâche 9) : les
// cookies de session sont capturés une fois en mémoire (module partagé par tous les tests
// de ce fichier dans un même worker, spec `beforeAll`/`beforeEach` ci-dessous), jamais
// réinscrit à chaque test. Un fichier `storageState` (autre motif documenté par Playwright
// pour ce cas) s'est révélé peu fiable ici : la création du contexte du tout premier test
// peut démarrer avant que `beforeAll` n'ait fini d'écrire ce fichier, d'où `ENOENT` — les
// cookies en mémoire, posés explicitement par `beforeEach` avant chaque test, n'ont pas ce
// problème d'ordonnancement.
let sharedCookies: Cookie[] | undefined;

test.beforeAll(async ({ browser }) => {
  const context = await browser.newContext();
  const response = await context.request.post(`${API_BASE}/auth/register`, {
    data: {
      email: uniqueEmail(),
      password: PASSWORD,
      firstName: 'Nadia',
      lastName: 'ScoreE2E',
    },
  });
  expect(response.ok(), `inscription du compte partage (statut ${response.status()})`).toBeTruthy();

  // Aucun onboarding parcouru : le compte partagé reste volontairement sans compétence ni
  // expérience (spec §2 point 4, test 4 ci-dessous — « profil incomplet »), et
  // `ProtectedRoute` (spec `app/router/protected-route.tsx`) n'exige qu'une session valide
  // pour accéder à `/jobs`, jamais un onboarding termine.
  sharedCookies = await context.cookies();
  await context.close();
});

test.beforeEach(async ({ context }) => {
  if (!sharedCookies) throw new Error('Compte partage non inscrit (beforeAll) : voir la sortie du hook.');
  await context.addCookies(sharedCookies);
});

/** Jeton CSRF à double dépôt (spec `common/csrf.guard.ts`) : la même valeur que le cookie
 * `jt_csrf`, à répercuter dans l'en-tête `x-csrf-token` pour toute requête `page.request`
 * mutante — `apiRequest` (client web) le fait pour nous en usage normal, mais les sondes
 * directes ci-dessous contournent ce client. */
async function csrfHeader(page: Page): Promise<Record<string, string>> {
  const cookies = await page.context().cookies();
  const token = cookies.find((cookie) => cookie.name === 'jt_csrf')?.value;
  return token ? { 'x-csrf-token': token } : {};
}

interface JobsListProbe {
  items: { id: string }[];
  total: number;
}

/** Lecture directe de `GET /jobs` (mêmes clés courtes que l'URL du SPA, spec §6) : sert à
 * connaître l'état réel des offres semées sans dépendre du rendu ni de son minutage. */
async function fetchJobsList(page: Page, queryString: string): Promise<JobsListProbe> {
  const response = await page.request.get(`${API_BASE}/jobs?${queryString}`);
  expect(response.ok(), `GET /jobs?${queryString} (statut ${response.status()})`).toBeTruthy();
  return (await response.json()) as JobsListProbe;
}

/**
 * Sonde `POST /jobs/analyses` (tâche 6, en cours de développement en parallèle de cette
 * suite) sans consommer le budget d'analyse : sans IA configurée, le contrôleur répond
 * `AI_NOT_CONFIGURED` avant même de toucher au quota (`matching.controller.ts`,
 * `isConfigured()` vérifié avant la limite de débit) — sûr à appeler plusieurs fois.
 * Retourne le statut HTTP brut : `404` tant que la route n'est pas montée, `503` une fois
 * montée (le cas attendu sur cette machine, sans `ANTHROPIC_API_KEY`).
 */
async function probeAnalyses(page: Page, jobId: string): Promise<number> {
  const response = await page.request.post(`${API_BASE}/jobs/analyses`, {
    data: { jobIds: [jobId] },
    headers: await csrfHeader(page),
  });
  return response.status();
}

/** `GET /jobs/:id/match` existe-t-elle déjà (tâche 6) ? Simple sonde de statut, jamais de
 * budget d'analyse consommé (route de lecture seule). */
async function probeMatchDetail(page: Page, jobId: string): Promise<number> {
  const response = await page.request.get(`${API_BASE}/jobs/${jobId}/match`);
  return response.status();
}

test('score — sans ia, aucun score n est invente', async ({ page }) => {
  await page.goto('/jobs?depuis=31');
  await expect(page.getByRole('heading', { level: 1, name: "Offres d'emploi" })).toBeVisible();
  await expect(page.getByText(RESULT_SUBTITLE)).toBeVisible();

  // `MatchBadge` (spec §2/§7) : `role="img"`, libellé commençant par « Correspondance ».
  // Jamais affiché quand `job.match` est `null` (aucune analyse) — pas même un badge
  // « Correspondance non évaluée » sur la liste (réservé au panneau de détail).
  await expect(page.getByRole('img', { name: /^Correspondance/ })).toHaveCount(0);

  const list = await fetchJobsList(page, 'depuis=31');
  const [firstJob] = list.items;

  if (list.total === 0 || !firstJob) {
    test.info().annotations.push({
      type: 'note',
      description: 'aucune offre en base sur cette fenetre : etat "IA non configuree" non observable ici',
    });
  } else {
    const status = await probeAnalyses(page, firstJob.id);
    if (status === 404) {
      test.info().annotations.push({
        type: 'note',
        description: 'POST /jobs/analyses repond encore 404 (tache 6 en cours) : verification allegee, sans texte attendu',
      });
      // Ne doit jamais planter ni afficher une erreur générique à la place de la liste.
      await expect(page.getByRole('heading', { level: 1, name: "Offres d'emploi" })).toBeVisible();
      await expect(page.getByText(RESULT_SUBTITLE)).toBeVisible();
    } else {
      // Bandeau unique (spec §2/§4), affiché une seule fois pour toute la page — jamais un
      // score simulé à la place. `exact: true` : distingue ce texte de l'alerte « Connecteur
      // non configuré » (`SyncBanner`) potentiellement présente sur la même page.
      await expect(page.getByText(NOT_CONFIGURED_MESSAGE, { exact: true })).toBeVisible();
    }
  }

  // Onglets dépendants du score (spec §2/§7, tâche 8) : actifs même sans IA — l'absence de
  // score n'est jamais un état désactivé, juste un état vide potentiel (`JobList`).
  const forYouTab = page.getByRole('tab', { name: 'Pour vous' });
  const priorityTab = page.getByRole('tab', { name: 'Forte priorité' });
  await expect(forYouTab).toBeVisible();
  await expect(priorityTab).toBeVisible();
  await expect(forYouTab).not.toHaveAttribute('aria-disabled');
  await expect(priorityTab).not.toHaveAttribute('aria-disabled');
});

test('score — l onglet pour vous et le tri match se refletent dans l url', async ({ page }) => {
  await page.goto('/jobs');
  await expect(page.getByRole('heading', { level: 1, name: "Offres d'emploi" })).toBeVisible();
  await expect(page.getByText(RESULT_SUBTITLE)).toBeVisible();

  await page.getByRole('tab', { name: 'Pour vous' }).click();
  await expect(page).toHaveURL(/onglet=pour-vous/);

  await page.getByRole('combobox', { name: 'Trier par' }).click();
  await page.getByRole('option', { name: 'Meilleur match' }).click();
  await expect(page).toHaveURL(/tri=match/);

  await page.getByRole('combobox', { name: 'Trier par' }).click();
  await page.getByRole('option', { name: 'Pertinence' }).click();
  await expect(page).toHaveURL(/tri=pertinence/);
});

test('score — le detail propose l analyse ou l etat non configure', async ({ page }) => {
  const list = await fetchJobsList(page, 'depuis=31');
  const [firstJob] = list.items;

  if (!firstJob) {
    // Même comportement que `jobs.spec.ts` (« offre — detail introuvable ») : sans offre en
    // base, on vérifie le seul état qu'on peut atteindre de façon fiable.
    await page.goto('/jobs/introuvable');
    await expect(page.getByText('Offre introuvable.')).toBeVisible();
    test.info().annotations.push({ type: 'note', description: 'aucune offre en base pour ouvrir un detail' });
    return;
  }

  const jobId = firstJob.id;
  const matchStatus = await probeMatchDetail(page, jobId);

  await page.goto(`/jobs/${jobId}`);
  // Offre potentiellement disparue entre la lecture de la liste ci-dessus et cette navigation
  // (données modifiées en parallèle par un autre agent sur cette machine, spec tâche 9) : un
  // 404 sur cette seule offre n'est pas un échec de ce test, juste une donnée devenue instable.
  const panelHeading = page.getByText('Pourquoi cette offre vous correspond');
  const notFoundState = page.getByText('Offre introuvable.');
  await expect(panelHeading.or(notFoundState)).toBeVisible();
  if (await notFoundState.isVisible()) {
    test.info().annotations.push({
      type: 'note',
      description: `offre ${jobId} disparue entre la liste et la navigation (donnees modifiees en parallele)`,
    });
    return;
  }

  if (matchStatus === 404) {
    test.info().annotations.push({
      type: 'note',
      description: 'GET /jobs/:id/match repond encore 404 (tache 6 en cours) : verification allegee',
    });
    // Ne doit jamais planter : le reste du détail (en-tête, lien de retour) reste affiché.
    await expect(page.getByRole('link', { name: 'Offres', exact: true })).toBeVisible();
    return;
  }

  // Spec §2 point 3/4 : trois états valides selon l'analyse et le profil, jamais un score
  // inventé à la place. Le compte partagé n'a ni compétence ni expérience (voir `beforeAll`),
  // donc l'état attendu ici est l'avis de profil incomplet — mais les trois restent acceptés,
  // cette assertion couvrant aussi le cas où l'IA serait configurée sur une autre machine.
  const analyzeButton = page.getByRole('button', { name: 'Analyser cette offre' });
  const notConfiguredAlert = page.getByText(NOT_CONFIGURED_MESSAGE, { exact: true });
  const incompleteNotice = page.getByText(INCOMPLETE_PROFILE_MESSAGE, { exact: true });

  await expect(analyzeButton.or(notConfiguredAlert).or(incompleteNotice)).toBeVisible();
});

test('score — profil incomplet', async ({ page }) => {
  const list = await fetchJobsList(page, 'depuis=31');
  const [firstJob] = list.items;
  test.skip(!firstJob, 'aucune offre en base pour ouvrir un detail');
  // `test.skip` ci-dessus arrête déjà le test si `firstJob` est absent ; cette assertion ne
  // sert qu'à faire disparaître le type `undefined` restant pour TypeScript.
  if (!firstJob) return;

  const jobId = firstJob.id;
  const matchStatus = await probeMatchDetail(page, jobId);
  test.skip(matchStatus === 404, 'GET /jobs/:id/match repond encore 404 (tache 6 en cours)');

  await page.goto(`/jobs/${jobId}`);
  // Même précaution que le test précédent : une offre disparue entre la liste et la
  // navigation (données modifiées en parallèle) n'est pas un échec de ce test-ci.
  const panelHeading = page.getByText('Pourquoi cette offre vous correspond');
  const notFoundState = page.getByText('Offre introuvable.');
  await expect(panelHeading.or(notFoundState)).toBeVisible();
  test.skip(await notFoundState.isVisible(), `offre ${jobId} disparue entre la liste et la navigation`);

  // Compte partagé sans compétence ni expérience (spec §2 point 4) : le score n'est jamais
  // calculé, quel que soit l'état de l'IA — `MatchPanel` teste `profileComplete` avant même
  // de proposer « Analyser cette offre » (revue tâche 7, `1f71915`).
  await expect(page.getByText(INCOMPLETE_PROFILE_MESSAGE, { exact: true })).toBeVisible();

  const profileLink = page.getByRole('link', { name: 'Compléter mon profil' });
  await expect(profileLink).toBeVisible();
  await expect(profileLink).toHaveAttribute('href', '/profile');
});
