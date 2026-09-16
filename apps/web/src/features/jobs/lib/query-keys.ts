import type { JobSearchQuery } from '@jobtrack/shared';

/**
 * Une recherche équivalente (mêmes valeurs, ordre différent dans les tableaux
 * `communes`/`contractTypes`/...) doit produire la même clé de cache : les
 * champs tableau sont donc triés avant d'entrer dans la clé de requête. Sans
 * ce tri, une recherche reconstruite depuis l'URL dans un ordre différent de
 * celui posé par `jobs-page.tsx` recréerait une entrée de cache distincte au
 * lieu de réutiliser celle déjà en mémoire.
 */
function normalizeJobSearchQuery(query: JobSearchQuery) {
  return {
    ...query,
    communes: [...query.communes].sort(),
    contractTypes: [...query.contractTypes].sort(),
    remoteModes: [...query.remoteModes].sort(),
    experienceLevels: [...query.experienceLevels].sort(),
    sources: [...query.sources].sort(),
  };
}

/**
 * Clés de requête TanStack Query des offres, partagées entre les hooks
 * (`hooks/use-jobs.ts`) et les composants qui doivent invalider ou mettre à
 * jour le cache de l'extérieur (ex. `useSaveJob`, qui touche à la fois un
 * détail et toutes les listes en cache). `all` sert de préfixe commun ;
 * `['jobs', 'search']` (préfixe de `search(...)`) est utilisé directement par
 * `useSaveJob` pour cibler toutes les listes en cache sans connaître leurs
 * paramètres exacts.
 */
export const jobKeys = {
  all: ['jobs'] as const,
  capabilities: ['jobs', 'capabilities'] as const,
  search: (query: JobSearchQuery) => ['jobs', 'search', normalizeJobSearchQuery(query)] as const,
  detail: (id: string) => ['jobs', 'detail', id] as const,
  saved: ['jobs', 'saved'] as const,
  communes: (q: string) => ['jobs', 'communes', q] as const,
};
