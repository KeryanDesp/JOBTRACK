import type {
  BaseResumeDto,
  CoverLetterSummaryDto,
  CreateCoverLetterInput,
  CreateTailoredResumeInput,
  ResumeSummaryDto,
  UpdateCoverLetterInput,
  UpdateResumeInput,
  UpdateResumeTemplateInput,
} from '@jobtrack/shared';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { ApiError } from '@/services/api/client';
import {
  createLetter,
  deleteLetter,
  deleteResume,
  fetchBaseResume,
  fetchLetter,
  fetchLetters,
  fetchResume,
  fetchResumes,
  tailorResume,
  updateLetter,
  updateResume,
  updateResumeTemplate,
} from '@/services/api/resume';
import { resumeKeys } from '../lib/query-keys';

/** Message français lisible si `error` en porte un (`ApiError`), générique sinon. */
function errorMessage(error: unknown, fallback: string): string {
  return error instanceof ApiError ? error.message : fallback;
}

/**
 * Codes que `TailoringStatus`/la page lettre affichent déjà elles-mêmes,
 * lues directement depuis `mutation.error` (spec §2/§5/§6) : profil trop
 * vide (409 `PROFILE_INCOMPLETE`), IA non configurée (503
 * `AI_NOT_CONFIGURED` — jamais bloquant, le CV/la lettre restent
 * utilisables sans adaptation) et budget épuisé (429 `RATE_LIMITED`, un
 * nouvel essai immédiat n'aurait aucun sens). Un toast en plus, pour ces
 * trois codes précis, ferait doublon avec ce que la page montre déjà ;
 * toute autre erreur (réseau, 500, `AI_UNAVAILABLE`, `AI_OUTPUT_INVALID`…)
 * reste transitoire et n'a pas d'affichage dédié, donc garde son toast.
 */
const SILENT_TAILORING_CODES = new Set(['AI_NOT_CONFIGURED', 'PROFILE_INCOMPLETE', 'RATE_LIMITED']);

function isSilentTailoringError(error: unknown): boolean {
  return error instanceof ApiError && error.code !== undefined && SILENT_TAILORING_CODES.has(error.code);
}

export function useBaseResume() {
  return useQuery({ queryKey: resumeKeys.base, queryFn: fetchBaseResume });
}

/**
 * `PATCH /resume/template` (spec §2/§6 : sélecteur de modèle mémorisé) : le
 * choix s'applique immédiatement au CV principal en cache, avant la réponse
 * serveur (aucune raison d'attendre pour un simple changement de présentation) ;
 * un échec restaure la valeur précédente et informe l'utilisateur.
 */
export function useResumeTemplate() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (input: UpdateResumeTemplateInput) => updateResumeTemplate(input),
    onMutate: async (input) => {
      await queryClient.cancelQueries({ queryKey: resumeKeys.base });
      const previous = queryClient.getQueryData<BaseResumeDto>(resumeKeys.base);
      if (previous) {
        queryClient.setQueryData<BaseResumeDto>(resumeKeys.base, { ...previous, template: input.template });
      }
      return { previous };
    },
    onError: (error, _input, context) => {
      if (context?.previous) queryClient.setQueryData(resumeKeys.base, context.previous);
      toast.error(errorMessage(error, 'La mise à jour du modèle a échoué.'));
    },
    onSettled: () => {
      void queryClient.invalidateQueries({ queryKey: resumeKeys.base });
    },
  });
}

export function useResumes() {
  return useQuery({ queryKey: resumeKeys.list, queryFn: fetchResumes });
}

export function useResume(id: string) {
  return useQuery({ queryKey: resumeKeys.detail(id), queryFn: () => fetchResume(id), enabled: id !== '' });
}

/** `POST /resume/tailor` (spec §6) : place la version créée en cache et invalide la liste. */
export function useTailorResume() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (input: CreateTailoredResumeInput) => tailorResume(input),
    onSuccess: (resume) => {
      queryClient.setQueryData(resumeKeys.detail(resume.id), resume);
      void queryClient.invalidateQueries({ queryKey: resumeKeys.list });
    },
    onError: (error) => {
      // `PROFILE_INCOMPLETE`/`AI_NOT_CONFIGURED`/`RATE_LIMITED` : `TailoringStatus`
      // (features/resume/components/tailoring-status.tsx) lit `mutation.error`
      // directement et affiche déjà son propre état pour ces trois codes — un
      // toast ferait doublon (voir `isSilentTailoringError`).
      if (isSilentTailoringError(error)) return;
      toast.error(errorMessage(error, "L'adaptation du CV a échoué."));
    },
  });
}

/** `PATCH /resume/:id` (spec §6 : crée une nouvelle version `USER`). */
export function useUpdateResume(id: string) {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (input: UpdateResumeInput) => updateResume(id, input),
    onSuccess: (resume) => {
      queryClient.setQueryData(resumeKeys.detail(id), resume);
      void queryClient.invalidateQueries({ queryKey: resumeKeys.list });
    },
    onError: (error) => {
      toast.error(errorMessage(error, "L'enregistrement du CV a échoué."));
    },
  });
}

/**
 * `DELETE /resume/:id` (spec §6), suppression optimiste : la liste en cache
 * (`resumeKeys.list`) perd immédiatement l'entrée, restaurée si le serveur
 * refuse — même principe que `useSaveJob` (`features/jobs/hooks/use-jobs.ts`).
 */
export function useDeleteResume() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (id: string) => deleteResume(id),
    onMutate: async (id) => {
      await queryClient.cancelQueries({ queryKey: resumeKeys.list });
      const previous = queryClient.getQueryData<ResumeSummaryDto[]>(resumeKeys.list);
      queryClient.setQueryData<ResumeSummaryDto[]>(resumeKeys.list, (old) => old?.filter((item) => item.id !== id));
      return { previous };
    },
    onError: (error, _id, context) => {
      if (context?.previous) queryClient.setQueryData(resumeKeys.list, context.previous);
      toast.error(errorMessage(error, 'La suppression du CV a échoué.'));
    },
    onSettled: () => {
      void queryClient.invalidateQueries({ queryKey: resumeKeys.list });
    },
  });
}

export function useLetters() {
  return useQuery({ queryKey: resumeKeys.letters, queryFn: fetchLetters });
}

export function useLetter(id: string) {
  return useQuery({ queryKey: resumeKeys.letter(id), queryFn: () => fetchLetter(id), enabled: id !== '' });
}

/** `POST /resume/letters` (spec §6). */
export function useCreateLetter() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (input: CreateCoverLetterInput) => createLetter(input),
    onSuccess: (letter) => {
      queryClient.setQueryData(resumeKeys.letter(letter.id), letter);
      void queryClient.invalidateQueries({ queryKey: resumeKeys.letters });
    },
    onError: (error) => {
      // Même principe que `useTailorResume` : ces trois codes ont leur propre
      // affichage côté page (lue depuis `mutation.error`), pas de toast en plus.
      if (isSilentTailoringError(error)) return;
      toast.error(errorMessage(error, 'La génération de la lettre a échoué.'));
    },
  });
}

/** `PATCH /resume/letters/:id`. */
export function useUpdateLetter(id: string) {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (input: UpdateCoverLetterInput) => updateLetter(id, input),
    onSuccess: (letter) => {
      queryClient.setQueryData(resumeKeys.letter(id), letter);
      void queryClient.invalidateQueries({ queryKey: resumeKeys.letters });
    },
    onError: (error) => {
      toast.error(errorMessage(error, "L'enregistrement de la lettre a échoué."));
    },
  });
}

/** `DELETE /resume/letters/:id`, suppression optimiste (même principe que `useDeleteResume`). */
export function useDeleteLetter() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (id: string) => deleteLetter(id),
    onMutate: async (id) => {
      await queryClient.cancelQueries({ queryKey: resumeKeys.letters });
      const previous = queryClient.getQueryData<CoverLetterSummaryDto[]>(resumeKeys.letters);
      queryClient.setQueryData<CoverLetterSummaryDto[]>(resumeKeys.letters, (old) => old?.filter((item) => item.id !== id));
      return { previous };
    },
    onError: (error, _id, context) => {
      if (context?.previous) queryClient.setQueryData(resumeKeys.letters, context.previous);
      toast.error(errorMessage(error, 'La suppression de la lettre a échoué.'));
    },
    onSettled: () => {
      void queryClient.invalidateQueries({ queryKey: resumeKeys.letters });
    },
  });
}
