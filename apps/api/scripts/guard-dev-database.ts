/**
 * Garde partagée par `seed-jobs-fixtures.ts` et `unseed-jobs-fixtures.ts` (revue
 * sécurité) : ces deux scripts insèrent ou suppriment en masse des offres
 * fictives, jamais acceptable sur une base de production. Deux conditions,
 * l'une bloquante et l'autre contournable explicitement :
 *  - `NODE_ENV=production` refuse toujours, sans échappatoire ;
 *  - une `DATABASE_URL` qui ne pointe pas vers `localhost`/`127.0.0.1` refuse
 *    aussi, sauf si `JOBS_SEED_CONFIRM=1` est positionné (base de développement
 *    distante assumée explicitement, ex. conteneur partagé).
 */
export function assertDevDatabase(): void {
  if (process.env.NODE_ENV === 'production') {
    throw new Error('Refusé : NODE_ENV=production.');
  }

  const host = databaseHost(process.env.DATABASE_URL);
  const isLocal = host === 'localhost' || host === '127.0.0.1';
  if (!isLocal && process.env.JOBS_SEED_CONFIRM !== '1') {
    throw new Error(
      `Refusé : DATABASE_URL ne pointe pas vers localhost (hôte détecté : ${host ?? 'indéterminé'}). ` +
        'Positionnez JOBS_SEED_CONFIRM=1 pour confirmer explicitement.',
    );
  }
}

/** `null` si `DATABASE_URL` est absente ou n'est pas une URL exploitable — jamais une exception ici. */
function databaseHost(databaseUrl: string | undefined): string | null {
  if (!databaseUrl) return null;
  try {
    return new URL(databaseUrl).hostname;
  } catch {
    return null;
  }
}
