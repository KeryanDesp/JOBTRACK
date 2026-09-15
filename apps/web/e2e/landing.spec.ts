import { expect, test } from '@playwright/test';

test('la landing affiche toutes ses sections', async ({ page }) => {
  await page.goto('/');

  await expect(page.getByRole('heading', { level: 1 })).toContainText('Toutes vos opportunités.');
  await expect(page.getByRole('heading', { name: 'Recherchez partout' })).toBeVisible();
  await expect(
    page.getByRole('heading', { name: "L'IA analyse les offres pour vous" }),
  ).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Un CV adapté à chaque offre' })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Suivez vos candidatures' })).toBeVisible();
  await expect(
    page.getByRole('heading', { name: 'Sachez ce qui fonctionne vraiment' }),
  ).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Simple et sans engagement' })).toBeVisible();
});

test('la page ne defile jamais horizontalement', async ({ page }) => {
  await page.goto('/');
  const overflows = await page.evaluate(
    () => document.documentElement.scrollWidth > document.documentElement.clientWidth,
  );
  expect(overflows).toBe(false);
});

test('une url inconnue affiche la page 404', async ({ page }) => {
  await page.goto('/cette-page-nexiste-pas');
  await expect(page.getByText("Cette page n'existe pas.")).toBeVisible();
});

test('le theme sombre est applique sans flash', async ({ page }) => {
  await page.addInitScript(() => localStorage.setItem('jobtrack-theme', 'dark'));
  await page.goto('/');
  await expect(page.locator('html')).toHaveClass(/dark/);
});
