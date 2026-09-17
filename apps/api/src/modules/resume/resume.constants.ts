/**
 * Budgets IA par utilisateur (spec §5/§8) : un seau `resume-tailoring` pour `POST /resume/tailor`,
 * un seau `cover-letter` pour `POST /resume/letters`. Comptés manuellement par
 * `ResumeTailoringService`/`CoverLetterService` juste avant l'appel Claude (revue sécurité, tâche
 * 5) — jamais par une garde posée sur la route (`@UserRateLimit`), qui consommait le budget avant
 * même les contrôles offre/profil/verrou. Constantes partagées : le contrôleur n'en a plus besoin
 * lui-même, mais elles restent le seul endroit où le nom du seau et la limite sont définis.
 */
export const RESUME_TAILORING_RATE_LIMIT = { limit: 20, windowSeconds: 3600, bucket: 'resume-tailoring' } as const;
export const COVER_LETTER_RATE_LIMIT = { limit: 10, windowSeconds: 3600, bucket: 'cover-letter' } as const;
