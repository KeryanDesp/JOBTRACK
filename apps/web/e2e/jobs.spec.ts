import { expect, test, type Page } from '@playwright/test';

// Même suffixe et même nettoyage que `auth.spec.ts`/`onboarding.spec.ts`
// (`apps/api/scripts/cleanup-e2e-users.ts`) : jamais un vrai domaine.
function uniqueEmail(): string {
  return `e2e-${Date.now()}-${Math.random().toString(36).slice(2)}@playwright.local`;
}

const PASSWORD = 'MotDePasseSolide-2026-e2e';

/** Une offre a été trouvée ou non (spec §2/§7) : les deux formes possibles du sous-titre. */
const RESULT_SUBTITLE = /offres?\s+trouvées?/;

async function register(page: Page, firstName: string, lastName: string): Promise<void> {
  await page.goto('/register');
  await page.getByLabel('Prénom').fill(firstName);
  // `exact: true` : sans lui, « Nom » matche aussi en sous-chaîne insensible à la
  // casse dans « Prénom » (Pré-nom) — voir auth.spec.ts.
  await page.getByLabel('Nom', { exact: true }).fill(lastName);
  await page.getByLabel('Email').fill(uniqueEmail());
  await page.getByLabel('Mot de passe').fill(PASSWORD);
  await page.getByRole('button', { name: 'Créer mon compte' }).click();
}

/**
 * Passe toute la configuration dès le premier écran de l'accueil (même
 * parcours que `onboarding.spec.ts` : « Passer » puis confirmation dans la
 * boîte de dialogue), pour atterrir sur `/profile` sans dépendre de l'IA de
 * lecture de CV ni du contenu des préférences.
 */
async function registerAndSkipOnboarding(page: Page, firstName: string, lastName: string): Promise<void> {
  await register(page, firstName, lastName);

  await expect(page).toHaveURL(/\/onboarding(\/bienvenue)?$/);
  await page.getByRole('button', { name: 'Passer' }).click();
  const dialog = page.getByRole('dialog');
  await expect(dialog).toContainText('Passer la configuration ?');
  await dialog.getByRole('button', { name: 'Passer' }).click();

  await expect(page).toHaveURL('/profile');
}

test('offres — etat du connecteur et navigation', async ({ page, isMobile }) => {
  await registerAndSkipOnboarding(page, 'Nadia', 'Offres');

  await page.goto('/jobs');
  await expect(page.getByRole('heading', { level: 1, name: "Offres d'emploi" })).toBeVisible();

  // Attend la fin du chargement de la recherche (spec §2) avant de juger de la
  // présence du bandeau ci-dessous : sans ce point d'ancrage, une absence
  // vérifiée trop tôt (avant même la réponse du serveur) passerait à tort.
  await expect(page.getByText(RESULT_SUBTITLE)).toBeVisible();

  const capabilities = await page.request.get('http://localhost:3001/api/v1/jobs/capabilities');
  const capabilitiesBody = (await capabilities.json()) as { sources: { franceTravail: boolean } };

  if (capabilitiesBody.sources.franceTravail) {
    await expect(page.getByText('Connecteur non configuré')).toHaveCount(0);
  } else {
    await expect(page.getByRole('alert')).toContainText('Connecteur non configuré');
  }

  // Navigation (spec tâche 10) : « Offres » est une entrée primaire (bottom nav mobile
  // directe), « Favoris » une entrée secondaire (derrière « Plus » sur mobile) — voir
  // `constants/navigation.ts` et `app-bottom-nav.tsx`. Ni l'une ni l'autre ne porte plus
  // le badge « Bientôt » (réservé aux écrans non encore livrés).
  const nav = page.getByRole('navigation', { name: 'Navigation principale' });
  const offresLink = nav.getByRole('link', { name: 'Offres', exact: true });
  await expect(offresLink).toBeVisible();
  await expect(offresLink).not.toContainText('Bientôt');

  if (isMobile) {
    await page.getByRole('button', { name: 'Plus' }).click();
    const favorisLink = page.getByRole('link', { name: 'Favoris', exact: true });
    await expect(favorisLink).toBeVisible();
    await expect(favorisLink).not.toContainText('Bientôt');
  } else {
    const favorisLink = nav.getByRole('link', { name: 'Favoris', exact: true });
    await expect(favorisLink).toBeVisible();
    await expect(favorisLink).not.toContainText('Bientôt');
  }
});

test('offres — la recherche met a jour l url', async ({ page }) => {
  await registerAndSkipOnboarding(page, 'Karim', 'Offres');

  await page.goto('/jobs');
  await expect(page.getByRole('heading', { level: 1, name: "Offres d'emploi" })).toBeVisible();

  await page.getByLabel('Mots-clés').fill('ingénieur');
  await page.getByRole('button', { name: 'Rechercher' }).click();

  // Encodé (`%C3%A9`) ou non selon le navigateur : les deux formes sont acceptées.
  await expect(page).toHaveURL(/q=(ing%C3%A9nieur|ing[ée]nieur)/i);
  await expect(page.getByText(RESULT_SUBTITLE)).toBeVisible();

  await page.getByRole('combobox', { name: 'Trier par' }).click();
  await page.getByRole('option', { name: 'Salaire' }).click();
  await expect(page).toHaveURL(/tri=salary/);

  // « Réinitialiser » (les filtres, pas le tri) ne s'affiche que si un filtre est actif
  // (spec `job-filters.tsx`, `hasActiveJobFilters`) — ni les mots-clés ni le tri n'en sont un,
  // ce bouton reste donc potentiellement absent ici : la vérification est conditionnelle.
  const resetButton = page.getByRole('button', { name: 'Réinitialiser', exact: true });
  if (await resetButton.isVisible()) {
    await resetButton.click();
    await expect(page).not.toHaveURL(/tri=/);
  }
});

test('offres — filtres mobile', async ({ page, isMobile }) => {
  test.skip(!isMobile, 'Le bouton « Filtres » (Sheet) est réservé au rendu mobile, en dessous de md.');

  await registerAndSkipOnboarding(page, 'Yasmine', 'Offres');
  await page.goto('/jobs');

  await page.getByRole('button', { name: 'Filtres', exact: true }).click();
  const sheet = page.getByRole('dialog', { name: 'Filtres' });
  await expect(sheet).toBeVisible();

  await page.keyboard.press('Escape');
  await expect(sheet).toBeHidden();
});

test('favoris — vide puis sauvegarde si des offres existent', async ({ page }) => {
  await registerAndSkipOnboarding(page, 'Malo', 'Favoris');

  await page.goto('/favorites');
  await expect(page.getByText('Aucune offre sauvegardée.')).toBeVisible();
  const browseButton = page.getByRole('button', { name: 'Parcourir les offres' });
  await expect(browseButton).toBeVisible();
  await browseButton.click();
  await expect(page).toHaveURL('/jobs');

  // `depuis=31` (spec tâche 10) : fenêtre de publication la plus large disponible dans les
  // filtres, pour maximiser les chances de retrouver des offres fictives déjà en base sans
  // dépendre d'une synchronisation réelle (identifiants France Travail absents sur cette machine).
  await page.goto('/jobs?depuis=31');
  // Attend la fin du chargement (squelettes sans bouton pendant la requête) avant de
  // compter les boutons : un comptage pris trop tôt verrait toujours zéro.
  await expect(page.getByText(RESULT_SUBTITLE)).toBeVisible();
  const saveButtons = page.getByRole('button', { name: "Sauvegarder l'offre" });
  const saveButtonsCount = await saveButtons.count();

  if (saveButtonsCount === 0) {
    await page.goto('/favorites');
    await expect(page.getByText('Aucune offre sauvegardée.')).toBeVisible();
    test.info().annotations.push({ type: 'note', description: 'aucune offre en base' });
    return;
  }

  // `saveButtons.first()` re-résout ce sélecteur (rôle + libellé) à chaque usage : une fois
  // la carte cliquée sauvegardée, son bouton bascule vers « Retirer des favoris » et sort de
  // ce même sélecteur — `.first()` pointerait alors, après le clic, vers une tout autre carte
  // encore non sauvegardée (toujours `aria-pressed=false`), pas vers celle qu'on vient de
  // cliquer. On vérifie donc la bascule par un décompte plutôt que sur la même référence.
  const firstSaveButton = saveButtons.first();
  // Attend la vraie réponse serveur (pas seulement la bascule optimiste) avant de naviguer :
  // une navigation plein document pendant que la requête est encore en vol pourrait l'annuler.
  await Promise.all([
    page.waitForResponse((response) => response.request().method() === 'POST' && response.url().includes('/save')),
    firstSaveButton.click(),
  ]);
  await expect(page.getByRole('button', { name: 'Retirer des favoris' })).toHaveCount(1);
  await expect(saveButtons).toHaveCount(saveButtonsCount - 1);

  await page.goto('/favorites');
  await expect(page.getByText('1 offre sauvegardée.')).toBeVisible();

  const removeButton = page.getByRole('button', { name: 'Retirer des favoris' });
  await Promise.all([
    page.waitForResponse((response) => response.request().method() === 'DELETE' && response.url().includes('/save')),
    removeButton.click(),
  ]);
  await expect(page.getByText('Aucune offre sauvegardée.')).toBeVisible();
});

test('offre — detail introuvable', async ({ page }) => {
  await registerAndSkipOnboarding(page, 'Sofia', 'Detail');

  await page.goto('/jobs/introuvable');
  await expect(page.getByText('Offre introuvable.')).toBeVisible();

  const backLink = page.getByRole('link', { name: 'Retour aux offres' });
  await expect(backLink).toBeVisible();
  await backLink.click();
  await expect(page).toHaveURL('/jobs');
});
