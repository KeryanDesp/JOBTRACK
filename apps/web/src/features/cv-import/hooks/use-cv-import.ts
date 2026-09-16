import type { CvApplyFormInput, CvImportDto, SessionUser } from '@jobtrack/shared';
import { useMutation, useQuery, useQueryClient, type UseMutationResult } from '@tanstack/react-query';
import { useCallback, useRef, useState } from 'react';
import { SESSION_QUERY_KEY } from '@/features/auth/hooks/use-session';
import { profileKeys } from '@/features/profile/lib/query-keys';
import { completeOnboarding } from '@/services/api/auth';
import type { ApiError } from '@/services/api/client';
import {
  applyCvImport,
  deleteCvImport,
  fetchCvCapabilities,
  fetchCvImport,
  retryCvImport,
  uploadCv,
} from '@/services/api/cv-import';
import { cvImportKeys } from '../lib/query-keys';

export function useCvCapabilities() {
  return useQuery({
    queryKey: cvImportKeys.capabilities,
    queryFn: fetchCvCapabilities,
    // Ne change qu'avec la configuration serveur (clé Anthropic posée ou non) :
    // pas besoin de la revalider à chaque focus de fenêtre.
    staleTime: 5 * 60_000,
  });
}

/** Brouillon d'un import (revue, retenter après échec). */
export function useCvImport(id: string) {
  return useQuery({
    queryKey: cvImportKeys.detail(id),
    queryFn: () => fetchCvImport(id),
  });
}

export interface UseUploadCvResult
  extends Pick<UseMutationResult<CvImportDto, ApiError, File>, 'mutate' | 'mutateAsync' | 'isPending' | 'error'> {
  /** Fraction (0 à 1) de l'envoi déjà transmis ; remise à 0 par `reset()` et au début d'un nouvel envoi. */
  progress: number;
  reset: () => void;
  /** Annule l'envoi en cours (aucun effet si aucun envoi n'est en cours). */
  abort: () => void;
}

/**
 * Import d'un CV. `progress` n'est pas un état natif de `useMutation` (React
 * Query ne suit pas la progression réseau) : on le maintient nous-mêmes via
 * `onProgress`, remis à zéro au lancement d'un envoi et par `reset()`.
 * `abort()` pilote un `AbortController` propre à chaque envoi (recréé à
 * chaque `mutate`) : une annulation volontaire n'est jamais présentée comme
 * une erreur (`code === 'ABORTED'` filtré ci-dessous), contrairement à un
 * vrai échec réseau ou serveur.
 */
export function useUploadCv(): UseUploadCvResult {
  const [progress, setProgress] = useState(0);
  const controllerRef = useRef<AbortController | null>(null);

  const mutation = useMutation<CvImportDto, ApiError, File>({
    mutationFn: (file) => {
      setProgress(0);
      const controller = new AbortController();
      controllerRef.current = controller;
      return uploadCv(file, { onProgress: setProgress, signal: controller.signal });
    },
  });

  const reset = useCallback(() => {
    setProgress(0);
    mutation.reset();
  }, [mutation.reset]);

  const abort = useCallback(() => {
    controllerRef.current?.abort();
  }, []);

  const isAborted = mutation.error?.code === 'ABORTED';

  return {
    mutate: mutation.mutate,
    mutateAsync: mutation.mutateAsync,
    isPending: mutation.isPending,
    // Annulation volontaire : jamais montrée comme une progression ou une
    // erreur figée, on se comporte comme si l'envoi n'avait jamais eu lieu.
    progress: isAborted ? 0 : progress,
    error: isAborted ? null : mutation.error,
    reset,
    abort,
  };
}

/**
 * Application du brouillon au profil : invalide `profileKeys.all`, dont la
 * correspondance de préfixe par défaut de React Query couvre déjà
 * `profileKeys.preferences` et chaque `profileKeys.collection(name)` — pas
 * besoin de les énumérer une par une.
 */
export function useApplyCvImport() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: ({ id, body }: { id: string; body: CvApplyFormInput }) => applyCvImport(id, body),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: profileKeys.all });
    },
  });
}

export function useRetryCvImport() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (id: string) => retryCvImport(id),
    onSuccess: (_data, id) => {
      void queryClient.invalidateQueries({ queryKey: cvImportKeys.detail(id) });
    },
  });
}

export function useDeleteCvImport() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (id: string) => deleteCvImport(id),
    onSuccess: (_data, id) => {
      queryClient.removeQueries({ queryKey: cvImportKeys.detail(id) });
    },
  });
}

/**
 * Termine l'accueil : met à jour le cache de session à froid (pas de nouvelle
 * requête `/auth/me`) pour que la bannière « Terminer la configuration » du
 * profil disparaisse sans rechargement, puis invalide quand même la session
 * pour qu'une prochaine lecture la revalide auprès du serveur.
 */
export function useCompleteOnboarding() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: completeOnboarding,
    onSuccess: () => {
      queryClient.setQueryData<SessionUser | null>(SESSION_QUERY_KEY, (old) =>
        old ? { ...old, onboardingCompleted: true } : old,
      );
      void queryClient.invalidateQueries({ queryKey: SESSION_QUERY_KEY });
    },
  });
}
