import type { SessionUser } from '@jobtrack/shared';
import { useQuery, useQueryClient, type UseQueryResult } from '@tanstack/react-query';
import { useCallback } from 'react';
import { ApiError } from '@/services/api/client';
import { fetchMe } from '@/services/api/auth';

export const SESSION_QUERY_KEY = ['session'] as const;

/**
 * Session courante. `null` signifie « visiteur non connecté » (une réponse
 * 401 de `/auth/me`), distinct de `undefined` qui signale que la requête est
 * encore en cours (`isPending`).
 */
export function useSession(): UseQueryResult<SessionUser | null> {
  return useQuery({
    queryKey: SESSION_QUERY_KEY,
    queryFn: async () => {
      try {
        return await fetchMe();
      } catch (error) {
        // 401 n'est pas une erreur applicative : c'est « pas connecté ».
        if (error instanceof ApiError && error.status === 401) return null;
        throw error;
      }
    },
    staleTime: 5 * 60_000,
    // Pas de `retry: false` ici : on hérite de `shouldRetry` (query-provider.tsx),
    // qui ne retente déjà jamais un 4xx (dont notre propre 401, traité ci-dessus
    // avant que la politique de nouvelle tentative n'entre en jeu) et retente deux
    // fois une panne réseau ou un 5xx.
  });
}

/**
 * Met à jour le cache de session sans requête réseau : utile juste après un
 * login/register/logout réussi, où la réponse porte déjà l'utilisateur (ou son absence).
 */
export function useSetSession(): (user: SessionUser | null) => void {
  const queryClient = useQueryClient();
  return useCallback(
    (user: SessionUser | null) => queryClient.setQueryData(SESSION_QUERY_KEY, user),
    [queryClient],
  );
}
