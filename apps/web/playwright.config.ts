import { defineConfig, devices } from '@playwright/test';

export default defineConfig({
  testDir: './e2e',
  use: { baseURL: 'http://localhost:5173' },
  globalTeardown: './e2e/global-teardown.ts',
  webServer: [
    {
      command: 'pnpm dev',
      url: 'http://localhost:5173',
      reuseExistingServer: !process.env.CI,
    },
    // Le parcours d'authentification (apps/web/e2e/auth.spec.ts) appelle la vraie
    // API : sans ce second serveur, `test:e2e` échouerait dès son premier appel réseau.
    {
      command: 'pnpm --filter @jobtrack/api dev',
      url: 'http://localhost:3001/api/v1/health',
      reuseExistingServer: !process.env.CI,
      timeout: 120_000,
    },
  ],
  projects: [
    { name: 'desktop', use: { ...devices['Desktop Chrome'] } },
    // Pixel 7 et non iPhone 13 : le profil iPhone impose WebKit, que l'on n'installe pas.
    { name: 'mobile', use: { ...devices['Pixel 7'] } },
  ],
});
