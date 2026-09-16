/**
 * Clés de requête TanStack Query de l'import de CV (`hooks/use-cv-import.ts`).
 * `detail` accepte `id: null` (aucun import en cours, ex. étape « Préférences »
 * de l'accueil sans extraction) et lui donne une clé stable propre — c'est la
 * seule fonction qui connaît cette conversion, pas ses appelants.
 */
export const cvImportKeys = {
  capabilities: ['cv-import', 'capabilities'] as const,
  detail: (id: string | null) => ['cv-import', id ?? 'none'] as const,
};
