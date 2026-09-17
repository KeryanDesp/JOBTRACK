import type { ApplicationListQueryInput } from '@jobtrack/shared';
import { applicationListQuerySchema } from '@jobtrack/shared';

/**
 * Clés de requête TanStack Query des candidatures, partagées entre
 * `hooks/use-applications.ts` et tout composant devant invalider ou mettre à
 * jour le cache de l'extérieur (même principe que `features/jobs/lib/query-keys.ts`
 * et `features/resume/lib/query-keys.ts`). `lists()` sert de préfixe commun à
 * toutes les pages de liste en cache (quels que soient leurs paramètres) :
 * `useUpdateApplication`/`useMoveApplication` s'en servent avec `setQueriesData`
 * pour toucher chaque page sans connaître ses paramètres exacts. `all` sert à
 * son tour de préfixe commun à `list`/`stats`/`board`/`detail` : une
 * invalidation sur `applicationKeys.all` (ex. `useDeleteApplication`) touche
 * l'ensemble en un seul appel.
 */
// Racine extraite en constante de module : `applicationKeys.all` n'est pas
// encore initialisé pendant l'évaluation du littéral ci-dessous, donc les
// propriétés non paresseuses (`stats`, `board`) ne peuvent pas s'y référer.
const ALL = ['applications'] as const;

export const applicationKeys = {
  all: ALL,
  lists: () => [...applicationKeys.all, 'list'] as const,
  // `applicationListQuerySchema.parse` (comme `jobKeys.search`) normalise la requête avant
  // qu'elle entre dans la clé : `{}` et `{ tab: 'all', page: 1, limit: 20, sort: 'updated_desc' }`
  // (mêmes valeurs, l'une implicite, l'autre explicite) partagent ainsi une seule entrée de
  // cache au lieu de deux copies parallèles des mêmes résultats.
  list: (query: ApplicationListQueryInput) => [...applicationKeys.lists(), applicationListQuerySchema.parse(query)] as const,
  stats: [...ALL, 'stats'] as const,
  board: [...ALL, 'board'] as const,
  detail: (id: string) => [...ALL, 'detail', id] as const,
};
