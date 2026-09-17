/**
 * Clés de requête TanStack Query du CV et des lettres de motivation, partagées
 * entre `hooks/use-resume.ts` et tout composant devant invalider/mettre à
 * jour le cache de l'extérieur (même principe que `features/jobs/lib/query-keys.ts`).
 */
export const resumeKeys = {
  all: ['resume'] as const,
  base: ['resume', 'base'] as const,
  list: ['resume', 'list'] as const,
  detail: (id: string) => ['resume', 'detail', id] as const,
  letters: ['resume', 'letters'] as const,
  letter: (id: string) => ['resume', 'letters', id] as const,
};
