import type { JobSearchQuery } from '@jobtrack/shared';
import { parseJobSearchParams, toJobSearchParams } from '@jobtrack/shared';
import { useCallback } from 'react';
import { useSearchParams } from 'react-router-dom';

// Fines enveloppes autour du contrat partagé (`packages/shared/src/jobs.ts`) :
// le web n'a pas sa propre table de clés courtes ni sa propre logique de
// défauts, seulement les noms attendus par le reste de la feature (`jobs-page.tsx`).
export const readJobSearchQuery = (searchParams: URLSearchParams): JobSearchQuery => parseJobSearchParams(searchParams);

export const writeJobSearchQuery = (query: JobSearchQuery): URLSearchParams => toJobSearchParams(query);

/**
 * Une recherche est « par défaut » quand sa sérialisation ne produit aucun
 * paramètre (`toJobSearchParams` omet déjà chaque champ égal à son défaut) :
 * pas de logique dupliquée ici, juste la conséquence du contrat partagé.
 */
export function isDefaultQuery(query: JobSearchQuery): boolean {
  return writeJobSearchQuery(query).toString() === '';
}

export interface SetJobSearchQueryOptions {
  /** Remplace l'entrée d'historique courante plutôt que d'en empiler une nouvelle. */
  replace?: boolean;
  /**
   * Remet `page` à 1. Par défaut : `true`, sauf quand `next` porte lui-même
   * `page` (changement de page explicite, ex. pagination) — dans ce cas la
   * page demandée est conservée à moins d'être explicitement écrasée.
   */
  resetPage?: boolean;
}

export type SetJobSearchQuery = (next: Partial<JobSearchQuery>, options?: SetJobSearchQueryOptions) => void;

/**
 * État de la recherche porté par l'URL (spec §2/§7) : lecture/écriture via
 * `useSearchParams`, avec remise à 1 de `page` sur tout changement de
 * filtre/tri/onglet — sauf si c'est justement `page` qui change. La mise à
 * jour se fait via la forme fonctionnelle de `setSearchParams` pour ne
 * jamais fusionner sur une valeur de `searchParams` déjà périmée (appels
 * rapprochés, ex. plusieurs cases cochées d'un coup).
 */
export function useJobSearchParams(): [JobSearchQuery, SetJobSearchQuery] {
  const [searchParams, setSearchParams] = useSearchParams();
  const query = readJobSearchQuery(searchParams);

  const setQuery = useCallback<SetJobSearchQuery>(
    (next, options = {}) => {
      const { replace = false } = options;
      setSearchParams(
        (previous) => {
          const current = readJobSearchQuery(previous);
          const merged: JobSearchQuery = { ...current, ...next };
          const resetPage = options.resetPage ?? !('page' in next);
          if (resetPage) merged.page = 1;
          return writeJobSearchQuery(merged);
        },
        { replace },
      );
    },
    [setSearchParams],
  );

  return [query, setQuery];
}
