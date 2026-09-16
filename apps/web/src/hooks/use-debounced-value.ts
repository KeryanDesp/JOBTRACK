import { useEffect, useState } from 'react';

/**
 * Renvoie `value` avec un anti-rebond : la valeur exposée ne se met à jour
 * qu'après `delayMs` sans nouvelle modification de `value`. Utilisé par la
 * recherche de communes (`features/jobs/hooks/use-jobs.ts`, `useCommuneSearch`)
 * pour éviter un appel réseau à chaque frappe au clavier.
 */
export function useDebouncedValue<T>(value: T, delayMs: number): T {
  const [debounced, setDebounced] = useState(value);

  useEffect(() => {
    const timeout = setTimeout(() => setDebounced(value), delayMs);
    return () => clearTimeout(timeout);
  }, [value, delayMs]);

  return debounced;
}
