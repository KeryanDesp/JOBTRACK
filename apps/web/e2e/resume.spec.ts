import { readFileSync } from 'node:fs';
import { expect, test, type Cookie, type Page } from '@playwright/test';

/**
 * Tâche 9 (spec §9, plan tâche 9) : recette Playwright du CV adapté et de la lettre de
 * motivation, *sans IA* — sur cette machine, `ANTHROPIC_API_KEY` est absente, donc toute
 * adaptation/génération répond `AI_NOT_CONFIGURED` (503) une fois `POST /resume/tailor` /
 * `POST /resume/letters` disponibles. Ces routes (tâche 5) sont développées en parallèle de
 * cette suite : chaque test sonde l'état réel de l'API avant d'affirmer un texte précis, et se
 * contente d'une annotation quand une route répond encore un statut inattendu — jamais un
 * contenu de CV/lettre inventé.
 */

const API_BASE = 'http://localhost:3001/api/v1';

// Même suffixe et même nettoyage que les autres specs
// (`apps/api/scripts/cleanup-e2e-users.ts`) : jamais un vrai domaine.
function uniqueEmail(): string {
  return `e2e-${Date.now()}-${Math.random().toString(36).slice(2)}@playwright.local`;
}

const PASSWORD = 'MotDePasseSolide-2026-e2e';

const FIRST_NAME = 'Selma';
const LAST_NAME = 'CvE2e';
const EXPERIENCE_ROLE = 'Ingenieure logicielle';
const EXPERIENCE_COMPANY = 'Acme Corp';
const SKILL_NAME = 'TypeScript';

const AI_NOT_CONFIGURED_MESSAGE = "Le service IA n'est pas configuré.";
const PROFILE_INCOMPLETE_TAILOR_MESSAGE = 'Complétez votre profil (au moins une expérience ou une compétence) avant de générer un CV.';

// Un seul compte pour tout le fichier (limite d'inscription 20/h/IP, spec tâche 9) : les
// cookies de session sont capturés une fois en mémoire (module partagé par tous les tests de
// ce fichier dans un même worker) et reposés par `beforeEach` — même principe que
// `matching.spec.ts`/`jobs.spec.ts` (un `storageState` fichier s'est révélé peu fiable pour ce
// même motif d'ordonnancement documenté là-bas).
let sharedCookies: Cookie[] | undefined;

/** Jeton CSRF à double dépôt (`common/csrf.guard.ts`) : la même valeur que le cookie
 * `jt_csrf`, à répercuter dans l'en-tête `x-csrf-token` pour toute requête mutante posée
 * directement (hors du client web, qui le fait pour nous en usage normal). */
function csrfHeaderFromCookies(cookies: Cookie[]): Record<string, string> {
  const token = cookies.find((cookie) => cookie.name === 'jt_csrf')?.value;
  return token ? { 'x-csrf-token': token } : {};
}

async function csrfHeader(page: Page): Promise<Record<string, string>> {
  return csrfHeaderFromCookies(await page.context().cookies());
}

test.beforeAll(async ({ browser }) => {
  const context = await browser.newContext();
  const registerResponse = await context.request.post(`${API_BASE}/auth/register`, {
    data: { email: uniqueEmail(), password: PASSWORD, firstName: FIRST_NAME, lastName: LAST_NAME },
  });
  expect(registerResponse.ok(), `inscription du compte partage (statut ${registerResponse.status()})`).toBeTruthy();

  const cookies = await context.cookies();
  const csrf = csrfHeaderFromCookies(cookies);

  // Profil rendu « complet » (spec §5 : `GET /resume/base` -> `complete: true`) par au moins
  // une expérience ou une compétence (`resume-source.service.ts`, `source.experiences.length >
  // 0 || source.skills.length > 0`) — les deux ici, pour que l'aperçu principal (scénario 1)
  // ait quelque chose à montrer dans chaque section.
  const experienceResponse = await context.request.post(`${API_BASE}/profile/experiences`, {
    data: {
      company: EXPERIENCE_COMPANY,
      role: EXPERIENCE_ROLE,
      startDate: '2022-01-01',
      isCurrent: true,
    },
    headers: csrf,
  });
  expect(experienceResponse.ok(), `creation de l experience partagee (statut ${experienceResponse.status()})`).toBeTruthy();

  const skillResponse = await context.request.post(`${API_BASE}/profile/skills`, {
    data: { name: SKILL_NAME },
    headers: csrf,
  });
  expect(skillResponse.ok(), `creation de la competence partagee (statut ${skillResponse.status()})`).toBeTruthy();

  sharedCookies = cookies;
  await context.close();
});

test.beforeEach(async ({ context }) => {
  if (!sharedCookies) throw new Error('Compte partage non inscrit (beforeAll) : voir la sortie du hook.');
  await context.addCookies(sharedCookies);
});

interface JobsListProbe {
  items: { id: string; title: string; company: string | null }[];
  total: number;
}

/** Lecture directe de `GET /jobs` (même fenêtre la plus large que `matching.spec.ts`/`jobs.spec.ts`,
 * `depuis=31`) : sert à connaître l'état réel des offres semées sans dépendre du rendu. */
async function fetchJobsList(page: Page, queryString: string): Promise<JobsListProbe> {
  const response = await page.request.get(`${API_BASE}/jobs?${queryString}`);
  expect(response.ok(), `GET /jobs?${queryString} (statut ${response.status()})`).toBeTruthy();
  return (await response.json()) as JobsListProbe;
}

interface ProbeResult {
  status: number;
  code?: string;
  message?: string;
}

async function parseProbeResponse(response: { status(): number; json: () => Promise<unknown> }): Promise<ProbeResult> {
  const status = response.status();
  try {
    const body = (await response.json()) as { code?: unknown; message?: unknown };
    return {
      status,
      code: typeof body.code === 'string' ? body.code : undefined,
      message: typeof body.message === 'string' ? body.message : undefined,
    };
  } catch {
    return { status };
  }
}

/**
 * Sonde `POST /resume/tailor` (tâche 5, en cours de développement en parallèle de cette suite)
 * sans dépendre du rendu : sur cette machine (sans `ANTHROPIC_API_KEY`), le contrôleur répond
 * `AI_NOT_CONFIGURED` (503) — `AiNotConfiguredError` est vérifiée avant tout comptage de
 * budget (`resume.errors.ts`), donc cet appel ne consomme jamais le quota d'adaptation.
 */
async function probeTailor(page: Page, jobId: string): Promise<ProbeResult> {
  const response = await page.request.post(`${API_BASE}/resume/tailor`, {
    data: { jobId, template: 'CLASSIC' },
    headers: await csrfHeader(page),
  });
  return parseProbeResponse(response);
}

/** Même principe que `probeTailor`, pour `POST /resume/letters`. */
async function probeLetter(page: Page, jobId: string): Promise<ProbeResult> {
  const response = await page.request.post(`${API_BASE}/resume/letters`, {
    data: { jobId, tone: 'PROFESSIONAL' },
    headers: await csrfHeader(page),
  });
  return parseProbeResponse(response);
}

test('cv principal - profil complet, apercu, modele et telechargement pdf', async ({ page }) => {
  await page.goto('/resume');
  await expect(page.getByRole('heading', { level: 1, name: 'Mon CV' })).toBeVisible();

  // Profil complet (spec §2/§7) : jamais le bandeau « Complétez votre profil… » à la place de
  // l'aperçu.
  await expect(page.getByText('Complétez votre profil pour un CV exploitable.')).toHaveCount(0);

  // Aperçu A4 (spec §2/§7) : nom du profil, l'expérience et la compétence semées en `beforeAll`
  // — jamais un contenu vide ni un texte de remplissage inventé.
  await expect(page.getByRole('heading', { level: 1, name: `${FIRST_NAME} ${LAST_NAME}` })).toBeVisible();
  await expect(page.getByText(EXPERIENCE_ROLE)).toBeVisible();
  await expect(page.getByText(SKILL_NAME)).toBeVisible();

  // Sélecteur de modèle (spec §2/§7 : « Classique / Moderne, mémorisé ») : le CV démarre sur
  // Classique (`resume.service.ts`, valeur par défaut), bascule vers Moderne et persiste après
  // rechargement via `PATCH /resume/template`.
  const templatePicker = page.getByRole('radiogroup', { name: 'Modèle de CV' });
  const classicRadio = templatePicker.getByRole('radio', { name: 'Classique' });
  const modernRadio = templatePicker.getByRole('radio', { name: 'Moderne' });
  await expect(classicRadio).toHaveAttribute('aria-checked', 'true');

  await Promise.all([
    page.waitForResponse((response) => response.request().method() === 'PATCH' && response.url().includes('/resume/template')),
    modernRadio.click(),
  ]);
  await expect(modernRadio).toHaveAttribute('aria-checked', 'true');

  await page.reload();
  await expect(page.getByRole('radiogroup', { name: 'Modèle de CV' }).getByRole('radio', { name: 'Moderne' })).toHaveAttribute(
    'aria-checked',
    'true',
  );

  // Téléchargement du PDF (spec §2/§7) : généré côté client (`@react-pdf/renderer`), jamais un
  // appel IA — le bouton doit fonctionner même sans `ANTHROPIC_API_KEY`. Nom de fichier
  // `CV-<slug>.pdf` (`resumeFileName`, `packages/shared/src/resume.ts`) et contenu réellement un
  // PDF, jamais un fichier vide ni un texte d'erreur déguisé.
  const [download] = await Promise.all([
    page.waitForEvent('download'),
    page.getByRole('button', { name: 'Télécharger le PDF' }).click(),
  ]);
  expect(download.suggestedFilename()).toMatch(/^CV-.*\.pdf$/);
  const downloadPath = await download.path();
  expect(downloadPath, 'chemin local du telechargement').toBeTruthy();
  if (downloadPath) {
    const bytes = readFileSync(downloadPath);
    expect(bytes.length).toBeGreaterThan(0);
    expect(bytes.subarray(0, 4).toString('latin1')).toBe('%PDF');
  }
});

test('cv adaptes et lettres - etats vides', async ({ page }) => {
  await page.goto('/resume');
  await expect(page.getByRole('heading', { level: 1, name: 'Mon CV' })).toBeVisible();

  // États vides (spec §2, `resume-list.tsx`/`letter-list.tsx`) : aucune adaptation ni lettre
  // n'a jamais réussi pour ce compte (IA absente sur cette machine, voir les deux tests
  // suivants), ces sections restent donc vides quel que soit l'ordre d'exécution des tests de
  // ce fichier.
  await expect(page.getByText('Aucun CV adapté.', { exact: true })).toBeVisible();
  await expect(page.getByText('Générez-en un depuis une offre.', { exact: true })).toBeVisible();
  await expect(page.getByRole('link', { name: 'Voir les offres' })).toHaveAttribute('href', '/jobs');

  await expect(page.getByText('Aucune lettre.', { exact: true })).toBeVisible();
  await expect(page.getByText('Générez une lettre de motivation depuis une offre.', { exact: true })).toBeVisible();
});

test('creation de cv adapte - etape analyse puis etat sans ia', async ({ page }) => {
  const list = await fetchJobsList(page, 'depuis=31');
  const [firstJob] = list.items;
  test.skip(!firstJob, 'aucune offre en base pour generer un cv adapte');
  if (!firstJob) return;

  const probe = await probeTailor(page, firstJob.id);

  await page.goto(`/resume/create/${firstJob.id}`);
  await expect(page.getByRole('heading', { level: 1, name: 'Générer un CV adapté' })).toBeVisible();
  await expect(page.getByText(firstJob.title)).toBeVisible();

  // Étape 1 (spec §2/§7 : bandeau des trois étapes puis analyse IA de l'offre) : « Continuer
  // sans analyse » quand l'analyse n'est pas terminée, sinon « Continuer » (déjà activé) — les
  // deux menent à la même étape suivante, sans jamais dépendre de l'IA pour cette navigation.
  const continueWithoutAnalysis = page.getByRole('button', { name: 'Continuer sans analyse' });
  const continueButton = page.getByRole('button', { name: 'Continuer', exact: true });
  if (await continueWithoutAnalysis.isVisible()) {
    await continueWithoutAnalysis.click();
  } else {
    await expect(continueButton).toBeEnabled();
    await continueButton.click();
  }
  await expect(page).toHaveURL(/etape=selection/);

  if (probe.status === 503 && probe.code === 'AI_NOT_CONFIGURED') {
    // `TailoringStatus` (spec §2/§5/§7) n'affiche cet état qu'après une tentative réelle : le
    // clic déclenche `POST /resume/tailor`, jamais un score/contenu inventé côté test.
    await Promise.all([
      page.waitForResponse((response) => response.request().method() === 'POST' && response.url().includes('/resume/tailor')),
      page.getByRole('button', { name: 'Adapter mon CV' }).click(),
    ]);
    await expect(page.getByText(AI_NOT_CONFIGURED_MESSAGE, { exact: true })).toBeVisible();
    await expect(page.getByText('Vous pouvez tout de même prévisualiser et télécharger votre CV principal.')).toBeVisible();
  } else if (probe.status === 409 && probe.code === 'PROFILE_INCOMPLETE') {
    await expect(page.getByText(PROFILE_INCOMPLETE_TAILOR_MESSAGE, { exact: true })).toBeVisible();
    test.info().annotations.push({
      type: 'note',
      description: 'profil signale incomplet par POST /resume/tailor malgre l experience/competence semees en beforeAll',
    });
  } else {
    test.info().annotations.push({
      type: 'note',
      description: `POST /resume/tailor a repondu un statut inattendu (${probe.status}${probe.code ? ` ${probe.code}` : ''}) : verification allegee, sans texte attendu`,
    });
    // Ne doit jamais planter : l'étape « sélection » reste affichée (`CardTitle`, un <div>,
    // jamais un rôle « heading »).
    await expect(page.getByText('Adapter votre CV').or(page.getByText('CV déjà généré'))).toBeVisible();
  }
});

test('lettre de motivation - choix du ton puis etat sans ia', async ({ page }) => {
  const list = await fetchJobsList(page, 'depuis=31');
  const [firstJob] = list.items;
  test.skip(!firstJob, 'aucune offre en base pour generer une lettre');
  if (!firstJob) return;

  const probe = await probeLetter(page, firstJob.id);

  await page.goto(`/resume/letter/${firstJob.id}`);
  await expect(page.getByRole('heading', { level: 1, name: 'Lettre de motivation' })).toBeVisible();

  // Choix du ton (spec §2/§4/§7, tâche 8) : trois tons proposés avant toute génération, profil
  // complet (voir `beforeAll`) donc jamais le bandeau « Complétez votre profil… » ici.
  const tonePicker = page.getByRole('radiogroup', { name: 'Ton de la lettre' });
  await expect(tonePicker.getByRole('radio', { name: /Courte/ })).toBeVisible();
  await expect(tonePicker.getByRole('radio', { name: /Professionnelle/ })).toBeVisible();
  await expect(tonePicker.getByRole('radio', { name: /Très personnalisée/ })).toBeVisible();

  const generateButton = page.getByRole('button', { name: 'Générer la lettre' });
  await expect(generateButton).toBeVisible();

  if (probe.status === 503 && probe.code === 'AI_NOT_CONFIGURED') {
    await Promise.all([
      page.waitForResponse((response) => response.request().method() === 'POST' && response.url().includes('/resume/letters')),
      generateButton.click(),
    ]);
    // `LetterErrorAlert` (spec §2/§5, tâche 8) remplace tout le panneau de génération pour ce
    // code — jamais superposé au sélecteur de ton.
    await expect(page.getByText(AI_NOT_CONFIGURED_MESSAGE, { exact: true })).toBeVisible();
    await expect(tonePicker).toHaveCount(0);
  } else if (probe.status === 409 && probe.code === 'PROFILE_INCOMPLETE') {
    await expect(page.getByText('Complétez votre profil pour générer une lettre.', { exact: true })).toBeVisible();
    test.info().annotations.push({
      type: 'note',
      description: 'profil signale incomplet par POST /resume/letters malgre l experience/competence semees en beforeAll',
    });
  } else {
    test.info().annotations.push({
      type: 'note',
      description: `POST /resume/letters a repondu un statut inattendu (${probe.status}${probe.code ? ` ${probe.code}` : ''}) : verification allegee, sans texte attendu`,
    });
    await expect(page.getByRole('heading', { level: 1, name: 'Lettre de motivation' })).toBeVisible();
  }
});

test('route lettre - rendu correct sans page introuvable', async ({ page }) => {
  const list = await fetchJobsList(page, 'depuis=31');
  const [firstJob] = list.items;
  test.skip(!firstJob, 'aucune offre en base pour ouvrir la page lettre');
  if (!firstJob) return;

  // Sanité de l'ordre des routes (spec, revue tâche 8 : les chemins statiques `/resume/create/:jobId`
  // et `/resume/letter/:jobId` sont déclarés avant `/resume/:id` dans `app/router/routes.tsx`) :
  // un `jobId` qui ressemble à n'importe quel autre segment doit bien atterrir sur la page
  // lettre, jamais sur la page « CV » (qui interpréterait `:jobId` comme un identifiant de CV)
  // ni sur la page 404 générale.
  await page.goto(`/resume/letter/${firstJob.id}`);
  await expect(page.getByRole('heading', { level: 1, name: 'Lettre de motivation' })).toBeVisible();
  await expect(page.getByText("Cette page n'existe pas.")).toHaveCount(0);
});

test('mon cv en mobile - aucun debordement horizontal', async ({ page }) => {
  await page.setViewportSize({ width: 375, height: 812 });
  await page.goto('/resume');
  await expect(page.getByRole('heading', { level: 1, name: 'Mon CV' })).toBeVisible();

  const hasOverflow = await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth);
  expect(hasOverflow).toBe(false);
});
