import { execSync } from 'node:child_process';
import { resolve } from 'node:path';

/**
 * Nettoyage exécuté une fois, après toute la suite Playwright (tous
 * projets confondus) : supprime les comptes `@playwright.local` créés par
 * les specs ainsi que leurs sessions Redis. `cwd` pointe la racine du
 * monorepo (`apps/web/e2e` -> `../../..`) pour que le filtre pnpm résolve
 * le paquet `@jobtrack/api` quel que soit le répertoire d'où `playwright
 * test` a été lancé. `import.meta.dirname` (pas `__dirname`) : ce fichier
 * est chargé en ESM, comme `playwright.config.ts`.
 */
export default function globalTeardown(): void {
  const repoRoot = resolve(import.meta.dirname, '../../..');
  execSync('pnpm --filter @jobtrack/api e2e:cleanup', { stdio: 'inherit', cwd: repoRoot });
}
