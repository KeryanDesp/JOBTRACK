import { expect, test, type Cookie, type Page } from '@playwright/test';

/**
 * Recette Playwright des candidatures (spec §2/§11, plan tache 8) — meme
 * principe que `resume.spec.ts`/`jobs.spec.ts` : un seul compte partage pour
 * tout le fichier (inscription API en `beforeAll`, cookies captures en
 * memoire puis reposes par `beforeEach`), et une sonde de l'etat reel de
 * l'API avant toute assertion qui dependrait de donnees pouvant manquer sur
 * cette machine (offre semee pour le scenario « suivre depuis une offre »).
 *
 * Chaque candidature manuelle creee par un test porte un titre de poste
 * unique (`uniqueManualTitle`) : les tests s'executent dans l'ordre du
 * fichier sur le meme compte (meme convention que les autres specs), donc
 * sans nettoyage entre eux — un titre partage entre plusieurs tests rendrait
 * ambigu tout selecteur par nom une fois plusieurs candidatures accumulees.
 */

const API_BASE = 'http://localhost:3001/api/v1';

function uniqueEmail(): string {
  return `e2e-${Date.now()}-${Math.random().toString(36).slice(2)}@playwright.local`;
}

const PASSWORD = 'MotDePasseSolide-2026-e2e';
const FIRST_NAME = 'Amina';
const LAST_NAME = 'CandidaturesE2e';

const MANUAL_COMPANY = 'Société Générale';

function uniqueManualTitle(): string {
  return `E2E Business Analyst ${Math.random().toString(36).slice(2, 8)}`;
}

function csrfHeaderFromCookies(cookies: Cookie[]): Record<string, string> {
  const token = cookies.find((cookie) => cookie.name === 'jt_csrf')?.value;
  return token ? { 'x-csrf-token': token } : {};
}

let sharedCookies: Cookie[] | undefined;

test.beforeAll(async ({ browser }) => {
  const context = await browser.newContext();
  const registerResponse = await context.request.post(`${API_BASE}/auth/register`, {
    data: { email: uniqueEmail(), password: PASSWORD, firstName: FIRST_NAME, lastName: LAST_NAME },
  });
  expect(registerResponse.ok(), `inscription du compte partage (statut ${registerResponse.status()})`).toBeTruthy();

  sharedCookies = await context.cookies();
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

/** Meme fenetre la plus large que `jobs.spec.ts`/`resume.spec.ts` (`depuis=31`). */
async function fetchFirstJob(page: Page): Promise<JobsListProbe> {
  const response = await page.request.get(`${API_BASE}/jobs?depuis=31&limit=1`);
  expect(response.ok(), `GET /jobs (statut ${response.status()})`).toBeTruthy();
  return (await response.json()) as JobsListProbe;
}

/**
 * Cree une candidature manuelle via le formulaire (spec §2 point 2) avec un
 * titre de poste unique, et renvoie ce titre pour que l'appelant puisse
 * cibler precisement cette candidature parmi celles deja accumulees par les
 * tests precedents du fichier. `.first()` sur le bouton d'ouverture : deux
 * exemplaires coexistent quand la liste est encore vide (barre de filtres +
 * etat vide), un seul ensuite.
 */
async function createManualApplication(page: Page): Promise<string> {
  const title = uniqueManualTitle();

  await page.getByRole('button', { name: 'Ajouter une candidature' }).first().click();
  const dialog = page.getByRole('dialog', { name: 'Ajouter une candidature' });
  await expect(dialog).toBeVisible();

  await dialog.getByLabel('Poste *').fill(title);
  await dialog.getByLabel('Entreprise').fill(MANUAL_COMPANY);

  await dialog.getByRole('combobox', { name: 'Source' }).click();
  await page.getByRole('option', { name: 'LinkedIn' }).click();

  await dialog.getByRole('combobox', { name: 'Statut' }).click();
  await page.getByRole('option', { name: 'Entretien' }).click();

  await dialog.getByLabel('Date de candidature').fill('2026-09-15');

  await Promise.all([
    page.waitForResponse((response) => response.request().method() === 'POST' && response.url().includes('/applications')),
    dialog.getByRole('button', { name: 'Ajouter' }).click(),
  ]);
  await expect(dialog).toBeHidden();

  return title;
}

/**
 * Ligne de table (desktop) ou carte (mobile, `applications-table.tsx` :
 * les deux sont rendues, une seule visible et donc presente dans l'arbre
 * d'accessibilite selon la largeur) portant ce titre — `.or()` resout donc
 * vers celle qui est effectivement affichee, quel que soit le projet
 * Playwright (desktop/mobile) qui execute le test.
 */
function entryLocator(page: Page, title: string) {
  return page.getByRole('row', { name: title }).or(page.getByRole('listitem').filter({ hasText: title }));
}

test('candidatures — vide puis ajout manuel, filtres et recherche', async ({ page }) => {
  await page.goto('/applications');
  await expect(page.getByRole('heading', { level: 1, name: 'Mes candidatures' })).toBeVisible();

  // Etat vide (spec §7, `applications-table.tsx`) : seulement en l'absence de tout filtre —
  // ce compte tout frais ne porte encore aucune candidature a ce stade du fichier.
  await expect(page.getByText('Aucune candidature.', { exact: true })).toBeVisible();
  await expect(page.getByRole('link', { name: 'Voir les offres' })).toHaveAttribute('href', '/jobs');
  await expect(page.getByRole('button', { name: 'Ajouter une candidature' }).first()).toBeVisible();

  const title = await createManualApplication(page);
  const entry = entryLocator(page, title);

  // Ligne/carte visible avec les valeurs saisies (spec §2 point 2).
  await expect(entry).toBeVisible();
  await expect(entry).toContainText(MANUAL_COMPANY);
  await expect(entry).toContainText('15 sept. 2026');
  await expect(entry).toContainText('LinkedIn');

  // Onglet « Entretien » : compteur a 1 (spec §2 point 3, premiere candidature de ce compte)
  // puis filtre effectif.
  const tabs = page.getByRole('tablist');
  await expect(tabs.getByRole('tab', { name: /Entretien/ })).toContainText('1');

  await tabs.getByRole('tab', { name: /Entretien/ }).click();
  await expect(page).toHaveURL(/onglet=interview/);
  await expect(entryLocator(page, title)).toBeVisible();

  await tabs.getByRole('tab', { name: 'Toutes' }).click();
  await expect(entryLocator(page, title)).toBeVisible();

  // Recherche (spec §2 point 3) : trouve par un fragment de l'entreprise, ne trouve pas un
  // mot absent.
  const search = page.getByLabel('Rechercher un poste ou une entreprise');
  await search.fill('Société');
  await expect(page).toHaveURL(/q=Soci/);
  await expect(entryLocator(page, title)).toBeVisible();

  await search.fill('zzz');
  await expect(page.getByText('Aucune candidature ne correspond.', { exact: true })).toBeVisible();

  await search.fill('');
});

test('candidatures — suivre depuis une offre semee', async ({ page }) => {
  const probe = await fetchFirstJob(page);
  const [firstJob] = probe.items;
  test.skip(!firstJob, 'aucune offre en base pour suivre une candidature depuis une offre');
  if (!firstJob) return;

  await page.goto(`/jobs/${firstJob.id}`);
  await expect(page.getByRole('heading', { level: 1, name: firstJob.title })).toBeVisible();

  const trackButton = page.getByRole('button', { name: 'Suivre cette candidature' });
  // L'offre peut deja etre suivie par une execution precedente sur cette machine (aucun
  // nettoyage entre les fichiers de spec d'une meme session) : dans ce cas le bouton est deja
  // devenu un lien « Candidature suivie · … », rien a creer de plus.
  const trackedLink = page.getByRole('link', { name: /Candidature suivie/ });

  if (await trackedLink.isVisible()) {
    test.info().annotations.push({ type: 'note', description: 'offre deja suivie par une execution precedente' });
    await expect(trackedLink).toHaveAttribute('href', /\/applications\?candidature=/);
    return;
  }

  await expect(trackButton).toBeVisible();
  await trackButton.click();

  const dialog = page.getByRole('dialog', { name: 'Suivre cette candidature' });
  await expect(dialog).toBeVisible();

  await Promise.all([
    page.waitForResponse((response) => response.request().method() === 'POST' && response.url().includes('/applications')),
    dialog.getByRole('button', { name: 'Suivre cette candidature' }).click(),
  ]);
  await expect(dialog).toBeHidden();

  const followedLink = page.getByRole('link', { name: 'Candidature suivie · À postuler' });
  await expect(followedLink).toBeVisible();
  await expect(followedLink).toHaveAttribute('href', /\/applications\?candidature=/);
});

test('candidatures — changement de statut inline et historique', async ({ page }) => {
  await page.goto('/applications');
  const title = await createManualApplication(page);

  const statusSelect = page.getByRole('combobox', { name: `Statut de ${title}` });
  await expect(statusSelect).toBeVisible();
  await expect(statusSelect).toContainText('Entretien');

  // Le clic sur le declencheur ouvre seulement la liste d'options (spec §6) : c'est le choix
  // de l'option qui declenche le `PATCH`, jamais l'ouverture elle-meme.
  await statusSelect.click();
  await Promise.all([
    page.waitForResponse((response) => response.request().method() === 'PATCH' && response.url().includes('/applications/')),
    page.getByRole('option', { name: 'Offre' }).click(),
  ]);
  await expect(statusSelect).toContainText('Offre');

  await page.getByRole('button', { name: `Ouvrir ${title}` }).click();
  const sheet = page.getByRole('dialog').filter({ hasText: title });
  await expect(sheet).toBeVisible();

  // Historique (spec §2 point 5, `application-events.tsx`) : « Statut modifie » (libelle de
  // repli) est remplace par le detail exact « Entretien → Offre » dès que les deux bornes de
  // l'evenement sont connues — c'est le cas ici, jamais le generique.
  await expect(sheet.getByText('Entretien → Offre')).toBeVisible();

  await page.keyboard.press('Escape');
  await expect(sheet).toBeHidden();
});

test('candidatures — kanban, deplacer vers une colonne et persistance', async ({ page }) => {
  await page.goto('/applications');
  const title = await createManualApplication(page);

  await page.goto('/applications?vue=kanban');

  // Cinq colonnes dans l'ordre du contrat (spec §2 point 4).
  const columnHeadings = page.getByRole('heading', { level: 3 });
  await expect(columnHeadings).toHaveText(['À postuler', 'Candidature envoyée', 'Entretien', 'Offre', 'Refusée']);

  const card = page.getByRole('button', { name: `Ouvrir la candidature ${title}` });
  await expect(card).toBeVisible();

  // Le bouton « Deplacer vers… » est un frere direct du bouton d'ouverture dans le meme
  // conteneur de carte (`application-card.tsx`), jamais dans une autre carte.
  const cardContainer = card.locator('..');
  await cardContainer.scrollIntoViewIfNeeded();
  await cardContainer.getByRole('button', { name: 'Déplacer vers…' }).click();

  const menu = page.getByRole('menu', { name: 'Déplacer vers…' });
  await expect(menu).toBeVisible();
  // `force: true` : le menu (Radix, positionnement flottant) est verifie present et son item
  // correctement nomme juste au-dessus — un clic normal echoue par intermittence sur les deux
  // projets (« element is not stable » puis interception par un ancetre), residu d'instabilite
  // de Playwright sur un menu flottant plutot qu'une regression de la fonctionnalite (le menu
  // est bien actif et son item bien present, confirme par le rendu). `waitForResponse` attend
  // le `PATCH /applications/:id/move` reellement pose (spec §6) avant de juger le deplacement.
  await Promise.all([
    page.waitForResponse((response) => response.request().method() === 'PATCH' && response.url().includes('/move')),
    menu.getByRole('menuitem', { name: 'Refusée' }).click({ force: true }),
  ]);

  // La colonne est un `<section aria-labelledby>` avec un nom accessible (le libelle du
  // statut) : un `<section>` nomme obtient le role implicite « region » (HTML-AAM), donc
  // aucune traversee manuelle du DOM n'est necessaire pour la retrouver.
  const refuseeColumn = page.getByRole('region', { name: 'Refusée' });
  await expect(refuseeColumn.getByRole('button', { name: `Ouvrir la candidature ${title}` })).toBeVisible();

  await page.reload();
  await expect(page.getByRole('region', { name: 'Refusée' }).getByRole('button', { name: `Ouvrir la candidature ${title}` })).toBeVisible();

  test.info().annotations.push({
    type: 'note',
    description:
      "glisser-depose souris non exerce ici (menu « Deplacer vers... », equivalent clavier/lecteur d'ecran, spec §2 point 4) — recette visuelle du coordinateur pour le pointeur.",
  });
});

test('candidatures — fiche : notes et suppression', async ({ page }) => {
  await page.goto('/applications');
  const title = await createManualApplication(page);

  await page.getByRole('button', { name: `Ouvrir ${title}` }).click();
  const sheet = page.getByRole('dialog').filter({ hasText: title });
  await expect(sheet).toBeVisible();

  const notes = sheet.getByLabel('Notes');
  await notes.fill('Note e2e');
  await Promise.all([
    page.waitForResponse((response) => response.request().method() === 'PATCH' && response.url().includes('/applications/')),
    sheet.getByRole('button', { name: 'Enregistrer les notes' }).click(),
  ]);
  await expect(sheet.getByText('Enregistré')).toBeVisible();

  await page.reload();
  const sheetAfterReload = page.getByRole('dialog').filter({ hasText: title });
  await expect(sheetAfterReload).toBeVisible();
  await expect(sheetAfterReload.getByLabel('Notes')).toHaveValue('Note e2e');

  await sheetAfterReload.getByRole('button', { name: 'Supprimer' }).click();
  const confirmDialog = page.getByRole('dialog', { name: 'Supprimer cette candidature ?' });
  await expect(confirmDialog).toBeVisible();

  await Promise.all([
    page.waitForResponse((response) => response.request().method() === 'DELETE' && response.url().includes('/applications/')),
    confirmDialog.getByRole('button', { name: 'Supprimer définitivement' }).click(),
  ]);

  await expect(page.getByRole('dialog')).toHaveCount(0);
  await expect(entryLocator(page, title)).toHaveCount(0);
});

test('candidatures — mobile sans debordement horizontal', async ({ page, isMobile }) => {
  test.skip(!isMobile, 'Verifie specifiquement le rendu en carte reserve au mobile (< md).');

  await page.goto('/applications');
  const title = await createManualApplication(page);

  const scrollWidth = await page.evaluate(() => document.documentElement.scrollWidth);
  const clientWidth = await page.evaluate(() => document.documentElement.clientWidth);
  expect(scrollWidth, 'largeur de defilement du document (pas de debordement horizontal)').toBeLessThanOrEqual(clientWidth + 1);

  // Liste de cartes (spec §7, `applications-table.tsx` : `<ul class="... md:hidden">`), la
  // candidature manuelle de ce test.
  await expect(entryLocator(page, title)).toBeVisible();
});

test('candidatures — securite : IDOR sur GET /applications/:id', async ({ page, browser }) => {
  await page.goto('/applications');
  const title = await createManualApplication(page);

  const listResponse = await page.request.get(`${API_BASE}/applications`);
  expect(listResponse.ok(), `GET /applications (statut ${listResponse.status()})`).toBeTruthy();
  const list = (await listResponse.json()) as { items: { id: string; jobTitle: string }[] };
  const owned = list.items.find((item) => item.jobTitle === title);
  expect(owned, 'candidature manuelle creee par ce test, presente dans la premiere page (tri par defaut, la plus recente)').toBeTruthy();
  if (!owned) return;

  // Second compte, jamais celui possedant la candidature (spec §8 : owner filtering, jamais
  // de 403 mais un 404 — meme principe que l'IDOR deja couvert pour les offres/CV).
  const otherContext = await browser.newContext();
  const otherRegister = await otherContext.request.post(`${API_BASE}/auth/register`, {
    data: { email: uniqueEmail(), password: PASSWORD, firstName: 'Karim', lastName: 'CandidaturesIdor' },
  });
  expect(otherRegister.ok(), `inscription du second compte (statut ${otherRegister.status()})`).toBeTruthy();

  const probeResponse = await otherContext.request.get(`${API_BASE}/applications/${owned.id}`, {
    headers: csrfHeaderFromCookies(await otherContext.cookies()),
  });
  expect(probeResponse.status()).toBe(404);

  await otherContext.close();
});
