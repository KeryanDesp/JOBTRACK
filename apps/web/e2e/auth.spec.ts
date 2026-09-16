import { expect, test } from '@playwright/test';

// `@playwright.local` : filtré et supprimé par `pnpm --filter @jobtrack/api e2e:cleanup`
// (voir apps/api/scripts/cleanup-e2e-users.ts), jamais un vrai domaine.
function uniqueEmail(): string {
  return `e2e-${Date.now()}-${Math.random().toString(36).slice(2)}@playwright.local`;
}

const PASSWORD = 'MotDePasseSolide-2026-e2e';

test('inscription, saisie du profil, deconnexion et reconnexion', async ({ page }) => {
  const email = uniqueEmail();

  // Inscription.
  await page.goto('/register');
  await page.getByLabel('Prénom').fill('Ada');
  // `exact: true` : sans lui, « Nom » matche aussi en sous-chaîne insensible à la
  // casse dans « Prénom » (Pré-nom).
  await page.getByLabel('Nom', { exact: true }).fill('Lovelace');
  await page.getByLabel('Email').fill(email);
  await page.getByLabel('Mot de passe').fill(PASSWORD);
  await page.getByRole('button', { name: 'Créer mon compte' }).click();

  await expect(page).toHaveURL('/profile');
  await expect(page.getByRole('heading', { level: 1, name: 'Mon profil' })).toBeVisible();

  // Informations personnelles : premier des trois boutons « Enregistrer » de la page.
  await page.getByLabel('Ville').fill('Metz');
  await page.getByRole('button', { name: 'Enregistrer' }).first().click();
  await expect(page.getByText('Enregistré.').first()).toBeVisible();

  // Compétences : deux boutons « Ajouter une compétence » tant que la liste est vide
  // (en-tête de carte + état vide) — les deux ouvrent la même boîte de dialogue.
  await page.getByRole('button', { name: 'Ajouter une compétence' }).first().click();
  const skillDialog = page.getByRole('dialog');
  await skillDialog.getByLabel('Nom').fill('TypeScript');
  await skillDialog.getByRole('button', { name: 'Enregistrer' }).click();
  await expect(skillDialog).toBeHidden();
  await expect(page.getByText('TypeScript')).toBeVisible();

  // Persistance réelle : un rechargement complet doit retrouver les mêmes données.
  await page.reload();
  await expect(page.getByLabel('Ville')).toHaveValue('Metz');
  await expect(page.getByText('TypeScript')).toBeVisible();

  // Déconnexion depuis l'onglet « Compte » des paramètres.
  await page.goto('/settings');
  await page.getByRole('tab', { name: 'Compte' }).click();
  await page.getByRole('button', { name: 'Se déconnecter' }).click();
  await expect(page).toHaveURL('/login');

  // Route protégée : un visiteur déconnecté est renvoyé vers la connexion.
  await page.goto('/profile');
  await expect(page).toHaveURL(/\/login/);

  // Reconnexion : les données saisies plus haut sont toujours là.
  await page.getByLabel('Email').fill(email);
  await page.getByLabel('Mot de passe').fill(PASSWORD);
  await page.getByRole('button', { name: 'Se connecter' }).click();

  await expect(page).toHaveURL('/profile');
  await expect(page.getByText('TypeScript')).toBeVisible();
});

test('refuse des identifiants invalides avec un message lisible', async ({ page }) => {
  await page.goto('/login');
  await page.getByLabel('Email').fill(uniqueEmail());
  await page.getByLabel('Mot de passe').fill('un-mot-de-passe-quelconque');
  await page.getByRole('button', { name: 'Se connecter' }).click();

  const alert = page.getByRole('alert');
  await expect(alert).toContainText('Identifiants invalides.');
  await expect(alert).not.toContainText('401');
});
