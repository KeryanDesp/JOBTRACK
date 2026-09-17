import type {
  ApplicationBoardDto,
  ApplicationDetailDto,
  ApplicationDto,
  ApplicationListQueryInput,
  ApplicationListResponseDto,
  CreateApplicationInput,
  MoveApplicationInput,
  UpdateApplicationInput,
} from '@jobtrack/shared';
import { APPLICATION_STATUSES, isCreateFromJob } from '@jobtrack/shared';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { jobKeys } from '@/features/jobs/lib/query-keys';
import { ApiError } from '@/services/api/client';
import {
  createApplication,
  deleteApplication,
  fetchApplication,
  fetchApplicationBoard,
  fetchApplicationStats,
  fetchApplications,
  moveApplication,
  updateApplication,
} from '@/services/api/applications';
import { applicationKeys } from '../lib/query-keys';

/** Message français lisible si `error` en porte un (`ApiError`), générique sinon. */
function errorMessage(error: unknown, fallback: string): string {
  return error instanceof ApiError ? error.message : fallback;
}

export function useApplications(query: ApplicationListQueryInput) {
  return useQuery({ queryKey: applicationKeys.list(query), queryFn: () => fetchApplications(query) });
}

export function useApplicationStats() {
  return useQuery({ queryKey: applicationKeys.stats, queryFn: fetchApplicationStats });
}

export function useApplicationsBoard() {
  return useQuery({ queryKey: applicationKeys.board, queryFn: fetchApplicationBoard });
}

export function useApplication(id: string | undefined) {
  return useQuery({
    queryKey: applicationKeys.detail(id ?? ''),
    queryFn: () => fetchApplication(id ?? ''),
    enabled: id !== undefined,
  });
}

/**
 * `POST /applications` (spec §4/§6) : la carte créée n'existe encore dans
 * aucune liste/aucun board en cache, donc rien à mettre à jour de façon
 * optimiste — seulement invalider ce qui doit désormais l'afficher, plus le
 * détail de l'offre d'origine (`jobKeys.detail`) quand la création vient
 * d'une offre suivie (`TrackApplicationButton`, tâche 7, y lit l'état
 * « suivie »). `APPLICATION_EXISTS` (409) : aucun toast, la page ouvre déjà
 * la fiche existante depuis `error.details.applicationId`.
 */
export function useCreateApplication() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (input: CreateApplicationInput) => createApplication(input),
    onSuccess: (application, input) => {
      queryClient.setQueryData(applicationKeys.detail(application.id), application);
      void queryClient.invalidateQueries({ queryKey: applicationKeys.lists() });
      void queryClient.invalidateQueries({ queryKey: applicationKeys.stats });
      void queryClient.invalidateQueries({ queryKey: applicationKeys.board });
      if (isCreateFromJob(input)) {
        void queryClient.invalidateQueries({ queryKey: jobKeys.detail(input.jobId) });
      }
    },
    onError: (error) => {
      if (error instanceof ApiError && error.code === 'APPLICATION_EXISTS') return;
      toast.error(errorMessage(error, 'Ajout impossible.'));
    },
  });
}

/**
 * Fusionne les champs fournis par `UpdateApplicationInput` dans une
 * `ApplicationDto` déjà en cache (spec §4) : les deux partagent les mêmes
 * noms de champs (`status`, `notes`, `resumeId`...), donc un simple mélange
 * suffit — pas de mise à jour partielle champ par champ à maintenir ici.
 */
function withOptimisticUpdate<T extends ApplicationDto>(item: T, input: UpdateApplicationInput): T {
  return Object.assign({}, item, input);
}

export interface UpdateApplicationVariables {
  id: string;
  input: UpdateApplicationInput;
}

/**
 * `PATCH /applications/:id` (spec §6), optimiste sur le détail et sur
 * chaque page de liste déjà en cache (`applicationKeys.lists()` comme
 * préfixe, même principe que `useSaveJob` pour les recherches d'offres) :
 * la fiche et la table doivent refléter le changement de statut/notes
 * immédiatement, avant la réponse serveur. Un échec restaure exactement
 * l'état capturé dans `onMutate`.
 */
export function useUpdateApplication() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: ({ id, input }: UpdateApplicationVariables) => updateApplication(id, input),
    onMutate: async ({ id, input }) => {
      await queryClient.cancelQueries({ queryKey: applicationKeys.detail(id) });
      await queryClient.cancelQueries({ queryKey: applicationKeys.lists() });

      const previousDetail = queryClient.getQueryData<ApplicationDetailDto>(applicationKeys.detail(id));
      const previousLists = queryClient.getQueriesData<ApplicationListResponseDto>({ queryKey: applicationKeys.lists() });

      if (previousDetail) {
        queryClient.setQueryData(applicationKeys.detail(id), withOptimisticUpdate(previousDetail, input));
      }

      queryClient.setQueriesData<ApplicationListResponseDto>({ queryKey: applicationKeys.lists() }, (old) => {
        if (!old) return old;
        return {
          ...old,
          items: old.items.map((item) => (item.id === id ? withOptimisticUpdate(item, input) : item)),
        };
      });

      return { previousDetail, previousLists };
    },
    onError: (error, { id }, context) => {
      if (context?.previousDetail) queryClient.setQueryData(applicationKeys.detail(id), context.previousDetail);
      if (context?.previousLists) {
        for (const [key, data] of context.previousLists) queryClient.setQueryData(key, data);
      }
      toast.error(errorMessage(error, 'Modification impossible.'));
    },
    onSettled: (_data, _error, { id }) => {
      void queryClient.invalidateQueries({ queryKey: applicationKeys.detail(id) });
      void queryClient.invalidateQueries({ queryKey: applicationKeys.lists() });
      void queryClient.invalidateQueries({ queryKey: applicationKeys.stats });
      void queryClient.invalidateQueries({ queryKey: applicationKeys.board });
    },
  });
}

export interface MoveApplicationVariables {
  id: string;
  input: MoveApplicationInput;
}

/**
 * Déplace une carte dans le board en cache (spec §2/§6) : retire la carte de
 * sa colonne d'origine, l'insère à `input.position` dans la colonne cible et
 * réindexe les positions (0..n-1) des deux colonnes — le serveur fait de même
 * en base dans une transaction, cette fonction pure reproduit uniquement le
 * résultat visible pour l'affichage optimiste. Renvoie `board` inchangé si la
 * carte n'est plus dans aucune colonne (déjà déplacée par un autre onglet).
 */
export function moveCardInBoard(board: ApplicationBoardDto, id: string, move: MoveApplicationInput): ApplicationBoardDto {
  let movedCard: ApplicationDto | undefined;
  let fromStatus: ApplicationDto['status'] | undefined;

  for (const status of APPLICATION_STATUSES) {
    const found = board.columns[status].find((item) => item.id === id);
    if (found) {
      movedCard = found;
      fromStatus = status;
      break;
    }
  }
  if (!movedCard || fromStatus === undefined) return board;

  const columns = { ...board.columns };
  columns[fromStatus] = columns[fromStatus].filter((item) => item.id !== id);

  const updatedCard: ApplicationDto = { ...movedCard, status: move.status };
  const targetColumn = fromStatus === move.status ? columns[fromStatus] : [...columns[move.status]];
  const insertIndex = Math.min(Math.max(move.position, 0), targetColumn.length);
  targetColumn.splice(insertIndex, 0, updatedCard);

  columns[move.status] = targetColumn.map((item, index) => ({ ...item, position: index }));
  // Colonne d'origine réindexée séparément seulement si distincte de la colonne
  // cible : sinon `columns[move.status]` ci-dessus l'a déjà remplacée en entier.
  if (fromStatus !== move.status) {
    columns[fromStatus] = columns[fromStatus].map((item, index) => ({ ...item, position: index }));
  }

  return { columns };
}

/**
 * `PATCH /applications/:id/move` (spec §2/§6), optimiste sur le board
 * uniquement (spec §4) : la table/le détail restent inchangés jusqu'à
 * `onSettled`, qui les invalide comme le reste. Un échec restaure le board
 * capturé avant le déplacement.
 */
export function useMoveApplication() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: ({ id, input }: MoveApplicationVariables) => moveApplication(id, input),
    onMutate: async ({ id, input }) => {
      await queryClient.cancelQueries({ queryKey: applicationKeys.board });

      const previousBoard = queryClient.getQueryData<ApplicationBoardDto>(applicationKeys.board);
      if (previousBoard) {
        queryClient.setQueryData(applicationKeys.board, moveCardInBoard(previousBoard, id, input));
      }

      return { previousBoard };
    },
    onError: (error, _variables, context) => {
      if (context?.previousBoard) queryClient.setQueryData(applicationKeys.board, context.previousBoard);
      toast.error(errorMessage(error, 'Déplacement impossible.'));
    },
    onSettled: (_data, _error, { id }) => {
      void queryClient.invalidateQueries({ queryKey: applicationKeys.board });
      void queryClient.invalidateQueries({ queryKey: applicationKeys.lists() });
      void queryClient.invalidateQueries({ queryKey: applicationKeys.stats });
      void queryClient.invalidateQueries({ queryKey: applicationKeys.detail(id) });
    },
  });
}

export interface DeleteApplicationVariables {
  id: string;
  /** Offre d'origine, quand connue de l'appelant (spec §4) : `jobKeys.detail` n'est invalidé que dans ce cas. */
  jobId?: string | null;
}

/**
 * `DELETE /applications/:id` (spec §6) : purge le détail du cache
 * (`removeQueries`, pas seulement une invalidation — même principe que
 * `useDeleteResume`, sinon `staleTime` laisserait la fiche supprimée
 * survivre jusqu'au prochain focus) puis invalide tout ce qui peut encore
 * l'afficher.
 */
export function useDeleteApplication() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: ({ id }: DeleteApplicationVariables) => deleteApplication(id),
    onSuccess: (_data, { id, jobId }) => {
      queryClient.removeQueries({ queryKey: applicationKeys.detail(id) });
      void queryClient.invalidateQueries({ queryKey: applicationKeys.lists() });
      void queryClient.invalidateQueries({ queryKey: applicationKeys.stats });
      void queryClient.invalidateQueries({ queryKey: applicationKeys.board });
      if (jobId) void queryClient.invalidateQueries({ queryKey: jobKeys.detail(jobId) });
      toast.success('Candidature supprimée.');
    },
    onError: (error) => {
      toast.error(errorMessage(error, 'La suppression a échoué.'));
    },
  });
}
