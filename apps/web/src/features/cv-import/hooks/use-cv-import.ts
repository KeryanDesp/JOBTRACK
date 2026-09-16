import type { CvApplyFormInput, CvImportDto, SessionUser } from '@jobtrack/shared';
import { useMutation, useQuery, useQueryClient, type UseMutationResult } from '@tanstack/react-query';
import { useCallback, useState } from 'react';
import { SESSION_QUERY_KEY, useSetSession } from '@/features/auth/hooks/use-session';
import { completeOnboarding } from '@/services/api/auth';
import type { ApiError } from '@/services/api/client';
import { applyCvImport, deleteCvImport, fetchCvCapabilities, retryCvImport, uploadCv } from '@/services/api/cv-import';
import { COLLECTIONS } from '@/services/api/profile';
import { CV_CAPABILITIES_QUERY_KEY } from '../lib/query-keys';

export function useCvCapabilities() {
  return useQuery({
    queryKey: CV_CAPABILITIES_QUERY_KEY,
    queryFn: fetchCvCapabilities,
    // Ne change qu'avec la configuration serveur (clé Anthropic posée ou non) :
    // pas besoin de la revalider à chaque focus de fenêtre.
    staleTime: 5 * 60_000,
  });
}

export interface UseUploadCvResult
  extends Pick<UseMutationResult<CvImportDto, ApiError, File>, 'mutate' | 'mutateAsync' | 'isPending' | 'error'> {
  /** Fraction (0 à 1) de l'envoi déjà transmis ; remise à 0 par `reset()` et au début d'un nouvel envoi. */
  progress: number;
  reset: () => void;
}

/**
 * Import d'un CV. `progress` n'est pas un état natif de `useMutation` (React
 * Query ne suit pas la progression réseau) : on le maintient nous-mêmes via
 * `onProgress`, remis à zéro au lancement d'un envoi et par `reset()`.
 */
export function useUploadCv(): UseUploadCvResult {
  const [progress, setProgress] = useState(0);

  const mutation = useMutation<CvImportDto, ApiError, File>({
    mutationFn: (file) => {
      setProgress(0);
      return uploadCv(file, { onProgress: setProgress });
    },
  });

  const reset = useCallback(() => {
    setProgress(0);
    mutation.reset();
  }, [mutation]);

  return {
    mutate: mutation.mutate,
    mutateAsync: mutation.mutateAsync,
    isPending: mutation.isPending,
    progress,
    error: mutation.error,
    reset,
  };
}

/**
 * Application du brouillon au profil : invalide le profil (identité) et
 * chaque collection concernée (`experiences`, `educations`, ...) pour que les
 * cartes et sections déjà montées se rechargent avec les éléments ajoutés.
 */
export function useApplyCvImport() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: ({ id, body }: { id: string; body: CvApplyFormInput }) => applyCvImport(id, body),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['profile'] });
      for (const collection of COLLECTIONS) {
        void queryClient.invalidateQueries({ queryKey: ['profile', collection] });
      }
    },
  });
}

export function useRetryCvImport() {
  return useMutation({ mutationFn: (id: string) => retryCvImport(id) });
}

export function useDeleteCvImport() {
  return useMutation({ mutationFn: (id: string) => deleteCvImport(id) });
}

/**
 * Termine l'accueil : met à jour le cache de session immédiatement après
 * succès (pas de nouvelle requête `/auth/me`) pour que la bannière « Terminer
 * la configuration » du profil disparaisse sans rechargement.
 */
export function useCompleteOnboarding() {
  const queryClient = useQueryClient();
  const setSession = useSetSession();

  return useMutation({
    mutationFn: completeOnboarding,
    onSuccess: () => {
      const current = queryClient.getQueryData<SessionUser | null>(SESSION_QUERY_KEY);
      if (current) setSession({ ...current, onboardingCompleted: true });
    },
  });
}
