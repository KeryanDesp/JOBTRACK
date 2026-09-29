import { resolve } from 'node:path';
import { config as loadDotenv } from 'dotenv';
import Redis from 'ioredis';

// Même résolution que `src/config/env.ts` et que `cleanup-e2e-users.ts` : le `.env` racine,
// présent qu'on lance ce script depuis la racine du monorepo ou depuis `apps/api`. Absent en
// CI, où les variables viennent de l'environnement — ignoré sans erreur dans ce cas.
loadDotenv({ path: [resolve(process.cwd(), '.env'), resolve(process.cwd(), '../../.env')] });

/**
 * Compteurs de débit remis à zéro entre deux fichiers de la suite Playwright.
 *
 * Toute la suite part d'une seule adresse IP (127.0.0.1 en local, l'exécuteur en CI), alors
 * que les budgets d'authentification sont conçus pour des visiteurs distincts : `/auth/register`
 * en autorise 20 par heure et par IP, quand la suite a besoin d'une vingtaine de comptes.
 * Sans cette remise à zéro, les derniers fichiers exécutés reçoivent des 429 et échouent pour
 * une raison qui n'a rien à voir avec ce qu'ils vérifient.
 *
 * Les budgets eux-mêmes ne sont pas relevés : ce sont des valeurs de production, et un test
 * doit s'exécuter contre la configuration réelle. Même parti pris que la suite e2e de l'API
 * (`applications.e2e.spec.ts`, `clearRateLimits`), qui vide ses propres seaux entre deux cas.
 */
const PATTERNS = ['ratelimit:*auth/register*', 'ratelimit:*auth/login*'];

function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`${name} est requis pour ce script.`);
  return value;
}

const redis = new Redis(requireEnv('REDIS_URL'));

async function main(): Promise<void> {
  // Motifs ciblés, jamais `ratelimit:*` en bloc : sur une machine de développement, ce Redis
  // est celui de l'application, et les autres compteurs ne regardent pas cette suite.
  const perPattern = await Promise.all(PATTERNS.map((pattern) => redis.keys(pattern)));
  const keys = perPattern.flat();

  if (keys.length > 0) await redis.del(...keys);

  console.log(`Debit e2e : ${keys.length} compteur(s) d'authentification remis a zero.`);
}

main()
  .catch((error: unknown) => {
    console.error(error);
    process.exit(1);
  })
  .finally(() => {
    redis.disconnect();
  });
