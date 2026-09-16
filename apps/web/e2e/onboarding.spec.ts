import { expect, test, type Page } from '@playwright/test';

// Même suffixe et même nettoyage que `auth.spec.ts`
// (`apps/api/scripts/cleanup-e2e-users.ts`) : jamais un vrai domaine.
function uniqueEmail(): string {
  return `e2e-${Date.now()}-${Math.random().toString(36).slice(2)}@playwright.local`;
}

const PASSWORD = 'MotDePasseSolide-2026-e2e';

interface CvCapabilities {
  ai: boolean;
}

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
 * Étape « Importer un CV » de l'accueil, prise par la voie manuelle dans les
 * deux cas possibles selon que l'IA est configurée sur cette machine
 * (`ANTHROPIC_API_KEY`) ou non : l'écran diffère (dropzone + lien discret vs.
 * message d'indisponibilité + bouton), mais les deux mènent à « préférences »
 * sans jamais dépendre d'un envoi réel de fichier.
 */
async function skipCvStepManually(page: Page): Promise<void> {
  const response = await page.request.get('http://localhost:3001/api/v1/cv-imports/capabilities');
  const capabilities = (await response.json()) as CvCapabilities;

  if (capabilities.ai) {
    await page.getByRole('button', { name: 'Je remplirai mon profil à la main' }).click();
  } else {
    await expect(page.getByRole('alert')).toContainText("L'analyse automatique n'est pas disponible");
    await page.getByRole('button', { name: 'Remplir à la main' }).click();
  }
}

test('inscription puis onboarding manuel jusqu au profil', async ({ page }) => {
  await register(page, 'Camille', 'Onboarding');

  // L'inscription mène toujours à l'accueil (jamais directement au profil) : `/onboarding`
  // sans étape affiche « bienvenue » sans redirection d'URL supplémentaire (voir
  // OnboardingPage, `rawStep = params.step ?? 'bienvenue'`).
  await expect(page).toHaveURL(/\/onboarding(\/bienvenue)?$/);
  await expect(page.getByRole('heading', { level: 2, name: 'Bienvenue, Camille' })).toBeVisible();

  await page.getByRole('button', { name: 'Commencer' }).click();
  await expect(page).toHaveURL('/onboarding/cv');

  await skipCvStepManually(page);
  await expect(page).toHaveURL('/onboarding/preferences');

  await page.getByLabel('Postes recherchés').fill('Développeur');
  await page.getByLabel('CDI').check();
  await page.getByRole('button', { name: 'Continuer' }).click();

  await expect(page).toHaveURL('/onboarding/fin');
  await expect(page.getByRole('heading', { level: 2, name: "C'est prêt" })).toBeVisible();

  // Un vrai lien : navigue même si l'appel de complétion posé au montage de cette
  // étape échoue ou n'a pas encore fini (voir DoneStep).
  await page.getByRole('link', { name: 'Voir mon profil' }).click();

  await expect(page).toHaveURL('/profile');
  await expect(page.getByRole('heading', { level: 1, name: 'Mon profil' })).toBeVisible();
  await expect(page.getByText('Terminer la configuration')).toHaveCount(0);

  // Persistance réelle, pas seulement la mise à jour du cache en mémoire.
  await page.reload();
  await expect(page.getByRole('heading', { level: 1, name: 'Mon profil' })).toBeVisible();
  await expect(page.getByText('Terminer la configuration')).toHaveCount(0);

  const me = await page.request.get('http://localhost:3001/api/v1/auth/me');
  const meBody = (await me.json()) as { onboardingCompleted: boolean };
  expect(meBody.onboardingCompleted).toBe(true);

  await expect(page.getByLabel('Postes recherchés')).toHaveValue('Développeur');
});

test('passer la configuration depuis la premiere etape', async ({ page }) => {
  await register(page, 'Léa', 'Onboarding');

  await expect(page).toHaveURL(/\/onboarding(\/bienvenue)?$/);

  await page.getByRole('button', { name: 'Passer' }).click();
  const dialog = page.getByRole('dialog');
  await expect(dialog).toContainText('Passer la configuration ?');
  await dialog.getByRole('button', { name: 'Passer' }).click();

  await expect(page).toHaveURL('/profile');
  await expect(page.getByText('Terminer la configuration')).toHaveCount(0);

  // Ni verrouillé ni caché après un abandon : l'accueil reste ouvert (accessible
  // depuis la bannière du profil, si elle était présente) et repart de sa
  // première étape.
  await page.goto('/onboarding');
  await expect(page.getByRole('heading', { level: 2, name: 'Bienvenue, Léa' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Précédent' })).toHaveCount(0);
});
