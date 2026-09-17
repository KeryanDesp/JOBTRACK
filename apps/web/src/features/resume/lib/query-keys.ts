/**
 * Clés de requête TanStack Query du CV et des lettres de motivation, partagées
 * entre `hooks/use-resume.ts` et tout composant devant invalider/mettre à
 * jour le cache de l'extérieur (même principe que `features/jobs/lib/query-keys.ts`).
 */
export const resumeKeys = {
  base: ['resume', 'base'] as const,
  list: ['resume', 'list'] as const,
  detail: (id: string) => ['resume', 'detail', id] as const,
  letters: ['resume', 'letters'] as const,
  // Sous 'letter' (singulier), pas sous la clé de liste 'letters' : une
  // invalidation de `letters` (la liste) ne doit jamais entraîner celle de
  // chaque détail en cache, et vice-versa — les deux doivent rester des
  // branches distinctes de l'arbre de clés.
  letter: (id: string) => ['resume', 'letter', id] as const,
};
