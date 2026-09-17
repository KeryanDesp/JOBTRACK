import type { ApplicationListQueryInput } from '@jobtrack/shared';

/**
 * Clés de requête TanStack Query des candidatures, partagées entre
 * `hooks/use-applications.ts` et tout composant devant invalider ou mettre à
 * jour le cache de l'extérieur (même principe que `features/jobs/lib/query-keys.ts`
 * et `features/resume/lib/query-keys.ts`). `lists()` sert de préfixe commun à
 * toutes les pages de liste en cache (quels que soient leurs paramètres) :
 * `useUpdateApplication`/`useMoveApplication` s'en servent avec `setQueriesData`
 * pour toucher chaque page sans connaître ses paramètres exacts.
 */
export const applicationKeys = {
  all: ['applications'] as const,
  lists: () => [...applicationKeys.all, 'list'] as const,
  list: (query: ApplicationListQueryInput) => [...applicationKeys.lists(), query] as const,
  stats: ['applications', 'stats'] as const,
  board: ['applications', 'board'] as const,
  detail: (id: string) => ['applications', 'detail', id] as const,
};
