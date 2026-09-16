import type { JobSearchQuery } from '@jobtrack/shared';
import { JOB_SEARCH_PARAM_KEYS, parseJobSearchParams, toJobSearchParams } from '@jobtrack/shared';
import { useCallback, useMemo, useRef } from 'react';
import { useSearchParams } from 'react-router-dom';

// Fines enveloppes autour du contrat partagé (`packages/shared/src/jobs.ts`) :
// le web n'a pas sa propre table de clés courtes ni sa propre logique de
// défauts, seulement les noms attendus par le reste de la feature (`jobs-page.tsx`).
export const readJobSearchQuery = (searchParams: URLSearchParams): JobSearchQuery => parseJobSearchParams(searchParams);

/**
 * `refresh` n'est jamais écrit dans l'URL, même quand il vaut vrai : c'est un
 * ordre ponctuel donné au serveur (« resynchronise cette recherche »), pas un
 * critère de recherche partageable ou rechargeable. Sans ce retrait, un lien
 * copié juste après un clic sur « Actualiser » redéclencherait indéfiniment
 * une synchronisation à chaque ouverture.
 */
export function writeJobSearchQuery(query: JobSearchQuery): URLSearchParams {
  const params = toJobSearchParams(query);
  params.delete(JOB_SEARCH_PARAM_KEYS.refresh);
  return params;
}

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
 * filtre/tri/onglet — sauf si c'est justement `page` qui change.
 *
 * La fusion ne passe pas par la forme fonctionnelle de `setSearchParams` :
 * sous react-router 6.30, l'callback passé à cette forme referme sur l'état
 * au moment de l'appel plutôt que sur le tout dernier état posé par un appel
 * précédent dans le même tick — deux appels rapprochés de `setQuery`
 * fusionneraient alors tous les deux sur la même valeur de départ, et le
 * second écraserait le premier au lieu de s'y ajouter. `paramsRef` garde donc
 * la dernière valeur connue (posée par un rendu ou par `setQuery` lui-même)
 * et la fusion se fait dessus avec la forme non fonctionnelle.
 */
export function useJobSearchParams(): [JobSearchQuery, SetJobSearchQuery] {
  const [searchParams, setSearchParams] = useSearchParams();
  const query = useMemo(() => readJobSearchQuery(searchParams), [searchParams]);

  const paramsRef = useRef(searchParams);
  paramsRef.current = searchParams;

  // Dépendance unique à `setSearchParams` (stable entre les rendus) : la
  // fonction renvoyée reste elle-même référentiellement stable, ce qui
  // évite de la lister à chaque fois dans les tableaux de dépendances des
  // effets qui la consomment.
  const setQuery = useCallback<SetJobSearchQuery>(
    (next, options = {}) => {
      const { replace = false } = options;
      const current = readJobSearchQuery(paramsRef.current);
      // `refresh: false` avant `...next` : un appel qui ne le mentionne pas
      // ne doit jamais hériter d'un `refresh` resté vrai de la recherche
      // précédente (il ne « colle » pas d'un changement de filtre à l'autre).
      const merged: JobSearchQuery = { ...current, refresh: false, ...next };
      const resetPage = options.resetPage ?? !('page' in next);
      if (resetPage) merged.page = 1;
      const nextParams = writeJobSearchQuery(merged);
      paramsRef.current = nextParams;
      setSearchParams(nextParams, { replace });
    },
    [setSearchParams],
  );

  return [query, setQuery];
}
