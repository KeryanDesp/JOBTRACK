import type { CollectionName } from '@/services/api/profile';

/**
 * Clés de requête TanStack Query du profil, partagées entre les cartes
 * (`cards/*.tsx`), les sections de collection (`components/collection-section.tsx`)
 * et tout ce qui doit invalider le profil depuis l'extérieur (import de CV).
 * `all` sert aussi de préfixe : `invalidateQueries({ queryKey: profileKeys.all })`
 * invalide déjà `preferences` et chaque collection (correspondance de préfixe
 * par défaut de React Query), sans qu'il faille les énumérer une par une.
 */
export const profileKeys = {
  all: ['profile'] as const,
  preferences: ['profile', 'preferences'] as const,
  collection: (name: CollectionName) => ['profile', name] as const,
};
