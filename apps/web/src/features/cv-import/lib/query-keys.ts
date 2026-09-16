/** Clés de requête TanStack Query de l'import de CV (`hooks/use-cv-import.ts`). */
export const cvImportKeys = {
  capabilities: ['cv-import', 'capabilities'] as const,
  detail: (id: string) => ['cv-import', id] as const,
};
