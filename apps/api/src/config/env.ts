import { resolve } from 'node:path';
import { config as loadDotenv } from 'dotenv';
import { serverEnvSchema, type ServerEnv } from '@jobtrack/shared';

// Le `.env` vit à la racine du monorepo. Selon qu'on lance depuis la racine
// (`pnpm dev`) ou depuis `apps/api` (`pnpm --filter @jobtrack/api dev`),
// il est à `./.env` ou à `../../.env`. Un fichier absent est ignoré sans
// erreur : en CI et en production, les variables viennent de l'environnement.
loadDotenv({ path: [resolve(process.cwd(), '.env'), resolve(process.cwd(), '../../.env')] });

/**
 * Hébergement Vercel (fonction serverless, préréglage « Services ») : quelques variables sont
 * dérivées de celles que la plateforme et le Marketplace injectent, pour qu'aucune valeur ne
 * soit à recopier à la main. Chaque dérivation ne s'applique que si la variable n'est pas déjà
 * définie explicitement — l'environnement explicite garde toujours la priorité.
 *  - `REDIS_URL` ← `KV_URL` (Upstash Redis via le Marketplace injecte `KV_URL`, un `rediss://`
 *    accepté tel quel par ioredis) ;
 *  - `WEB_ORIGIN` ← URL de production du projet (`VERCEL_PROJECT_PRODUCTION_URL`) en production,
 *    URL du déploiement (`VERCEL_URL`) en prévisualisation : web et API partagent le domaine ;
 *  - `STORAGE_DIR` ← `/tmp/jobtrack-storage` : seul dossier inscriptible d'une fonction (éphémère —
 *    suffisant pour l'import de CV, dont le fichier n'est lu que le temps de l'extraction).
 */
function applyVercelDefaults(source: NodeJS.ProcessEnv): void {
  if (source.VERCEL !== '1') return;
  if (!source.REDIS_URL && source.KV_URL) source.REDIS_URL = source.KV_URL;
  if (!source.WEB_ORIGIN) {
    const host = source.VERCEL_ENV === 'production' ? source.VERCEL_PROJECT_PRODUCTION_URL : source.VERCEL_URL;
    if (host) source.WEB_ORIGIN = `https://${host}`;
  }
  if (!source.STORAGE_DIR) source.STORAGE_DIR = '/tmp/jobtrack-storage';
}

applyVercelDefaults(process.env);

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
