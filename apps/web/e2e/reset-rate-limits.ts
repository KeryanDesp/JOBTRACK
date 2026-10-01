import { execSync } from 'node:child_process';
import { resolve } from 'node:path';

/**
 * Remet à zéro les compteurs de débit d'authentification, à appeler dans un `test.beforeAll`
 * de chaque fichier qui crée des comptes.
 *
 * Toute la suite part d'une seule adresse IP, alors que `/auth/register` n'autorise que 20
 * inscriptions par heure et par IP (une valeur de production, volontairement inchangée). La
 * suite complète en demande davantage : sans cette remise à zéro, les derniers fichiers
 * exécutés reçoivent des 429 et échouent pour une raison étrangère à ce qu'ils vérifient.
 *
 * Par fichier et non une seule fois avant la suite : un `globalSetup` ne relâcherait le budget
 * qu'au démarrage, et le plafond serait de nouveau atteint en cours d'exécution.
 *
 * Mêmes mécanismes que `global-teardown.ts` : `cwd` sur la racine du monorepo pour que le
 * filtre pnpm résolve `@jobtrack/api` quel que soit le répertoire d'appel, et
 * `import.meta.dirname` parce que ce fichier est chargé en ESM.
 */
export function resetRateLimits(): void {
  const repoRoot = resolve(import.meta.dirname, '../../..');
  execSync('pnpm --filter @jobtrack/api e2e:reset-limits', { stdio: 'inherit', cwd: repoRoot });
}
