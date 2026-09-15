import { resolve } from 'node:path';
import { config as loadDotenv } from 'dotenv';
import { serverEnvSchema, type ServerEnv } from '@jobtrack/shared';

// Le `.env` vit à la racine du monorepo. Selon qu'on lance depuis la racine
// (`pnpm dev`) ou depuis `apps/api` (`pnpm --filter @jobtrack/api dev`),
// il est à `./.env` ou à `../../.env`. Un fichier absent est ignoré sans
// erreur : en CI et en production, les variables viennent de l'environnement.
loadDotenv({ path: [resolve(process.cwd(), '.env'), resolve(process.cwd(), '../../.env')] });

/**
 * Valide l'environnement au démarrage. En cas d'erreur le processus s'arrête :
 * une API qui démarre avec une configuration incomplète échouerait plus tard,
 * de façon plus difficile à diagnostiquer.
 */
export function loadEnv(source: NodeJS.ProcessEnv = process.env): ServerEnv {
  const result = serverEnvSchema.safeParse(source);

  if (!result.success) {
    const details = result.error.issues
      .map((issue) => `  - ${issue.path.join('.')} : ${issue.message}`)
      .join('\n');
    throw new Error(`Configuration invalide. Corrigez votre fichier .env :\n${details}`);
  }

  return result.data;
}

export const env = loadEnv();
