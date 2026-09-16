import type { JobDetailDto, JobListResponseDto, JobSearchQuery, JobSummaryDto } from '@jobtrack/shared';
import { keepPreviousData, useMutation, useQuery, useQueryClient, type QueryClient } from '@tanstack/react-query';
import { useDebouncedValue } from '@/hooks/use-debounced-value';
import {
  fetchJob,
  fetchJobsCapabilities,
  fetchSavedJobs,
  saveJob,
  searchCommunes,
  searchJobs,
  unsaveJob,
} from '@/services/api/jobs';
import { jobKeys } from '../lib/query-keys';

// Préfixe commun à toutes les clés de `jobKeys.search(...)` : cible d'un
// `setQueriesData`/`invalidateQueries` portant sur « toutes les listes en
// cache », sans connaître les paramètres de chacune.
const SEARCH_PREFIX = ['jobs', 'search'] as const;

export function useJobsCapabilities() {
  return useQuery({
    queryKey: jobKeys.capabilities,
    queryFn: fetchJobsCapabilities,
    // Ne change qu'avec la configuration serveur (identifiants France Travail
    // posés ou non) : pas besoin de revalider à chaque focus de fenêtre.
    staleTime: 5 * 60_000,
  });
}

export function useJobSearch(query: JobSearchQuery, options: { enabled?: boolean } = {}) {
  return useQuery({
    queryKey: jobKeys.search(query),
    queryFn: () => searchJobs(query),
    enabled: options.enabled,
    // Garde la page précédente affichée pendant le chargement de la suivante
    // (pagination, changement de filtre) plutôt qu'un écran vide entre deux.
    placeholderData: keepPreviousData,
    // Le serveur ne resynchronise une recherche auprès de France Travail que
    // toutes les 15 minutes (spec §5, cache `jobs:sync:{hash}`) : revalider
    // le cache client plus souvent que ça ne changerait rien à la réponse,
    // juste une requête réseau de plus. 5 minutes reste bien en deçà de ce
    // cache serveur tout en évitant de garder un résultat affiché trop
    // longtemps sans jamais le confronter à nouveau au serveur.
    staleTime: 5 * 60_000,
  });
}

export function useJob(id: string) {
  return useQuery({
    queryKey: jobKeys.detail(id),
    queryFn: () => fetchJob(id),
  });
}

export function useSavedJobs() {
  return useQuery({
    queryKey: jobKeys.saved,
    queryFn: fetchSavedJobs,
  });
}

interface SaveJobVariables {
  id: string;
  saved: boolean;
}

/**
 * Cherche un résumé déjà en cache (une liste de recherche affichée) pour
 * l'insérer de façon optimiste dans les favoris sans attendre le prochain
 * `fetch` : `useSaveJob` peut être déclenché depuis une carte de résultat qui
 * porte déjà toutes les données nécessaires à l'affichage dans `/favorites`.
 */
function findCachedSummary(queryClient: QueryClient, id: string): JobSummaryDto | undefined {
  const searches = queryClient.getQueriesData<JobListResponseDto>({ queryKey: SEARCH_PREFIX });
  for (const [, data] of searches) {
    const found = data?.items.find((item) => item.id === id);
    if (found) return found;
  }
  return undefined;
}

// Clé et portée partagées par toutes les mutations de sauvegarde, quelle que
// soit l'offre concernée : `scope.id` sérialise les bascules rapprochées
// (deux clics sur la même carte, ou sur deux cartes à la fois) plutôt que de
// les laisser courir en parallèle, où la réponse la plus lente pourrait
// écraser l'état posé par la plus rapide.
const SAVE_MUTATION_KEY = ['jobs', 'save'] as const;
const SAVE_MUTATION_SCOPE = { id: 'jobs-save' };

/**
 * Sauvegarde/retrait optimiste (spec §7) : le détail (`jobKeys.detail`),
 * toutes les listes de recherche en cache et la liste des favoris sont mis à
 * jour immédiatement, avant la réponse serveur. Un échec restaure exactement
 * l'état capturé dans `onMutate` (rollback) ; `onSettled` invalide ensuite
 * ces mêmes clés pour que la vérité serveur finisse toujours par s'imposer,
 * succès ou échec — mais seulement une fois la dernière mutation en cours
 * réglée (`isMutating(...) === 1`) : invalider après chaque bascule d'une
 * série rapprochée réintroduirait brièvement l'état serveur (pas encore à
 * jour) entre deux optimistic updates.
 */
export function useSaveJob() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationKey: SAVE_MUTATION_KEY,
    scope: SAVE_MUTATION_SCOPE,
    mutationFn: ({ id, saved }: SaveJobVariables) => (saved ? saveJob(id) : unsaveJob(id)),
    onMutate: async ({ id, saved }) => {
      await queryClient.cancelQueries({ queryKey: jobKeys.detail(id) });
      await queryClient.cancelQueries({ queryKey: SEARCH_PREFIX });
      await queryClient.cancelQueries({ queryKey: jobKeys.saved });

      const previousDetail = queryClient.getQueryData<JobDetailDto>(jobKeys.detail(id));
      const previousSearches = queryClient.getQueriesData<JobListResponseDto>({ queryKey: SEARCH_PREFIX });
      const previousSaved = queryClient.getQueryData<JobSummaryDto[]>(jobKeys.saved);

      if (previousDetail) {
        queryClient.setQueryData<JobDetailDto>(jobKeys.detail(id), { ...previousDetail, saved });
      }

      queryClient.setQueriesData<JobListResponseDto>({ queryKey: SEARCH_PREFIX }, (old) => {
        if (!old) return old;
        return { ...old, items: old.items.map((item) => (item.id === id ? { ...item, saved } : item)) };
      });

      queryClient.setQueryData<JobSummaryDto[]>(jobKeys.saved, (old) => {
        if (!old) return old;
        if (saved) {
          if (old.some((item) => item.id === id)) return old;
          const summary = findCachedSummary(queryClient, id);
          return summary ? [{ ...summary, saved: true }, ...old] : old;
        }
        return old.filter((item) => item.id !== id);
      });

      return { previousDetail, previousSearches, previousSaved };
    },
    onError: (_error, { id }, context) => {
      if (!context) return;
      if (context.previousDetail) queryClient.setQueryData(jobKeys.detail(id), context.previousDetail);
      for (const [key, data] of context.previousSearches) queryClient.setQueryData(key, data);
      if (context.previousSaved) queryClient.setQueryData(jobKeys.saved, context.previousSaved);
    },
    onSettled: (_data, _error, { id }) => {
      if (queryClient.isMutating({ mutationKey: SAVE_MUTATION_KEY }) !== 1) return;
      void queryClient.invalidateQueries({ queryKey: jobKeys.saved });
      void queryClient.invalidateQueries({ queryKey: SEARCH_PREFIX });
      void queryClient.invalidateQueries({ queryKey: jobKeys.detail(id) });
    },
  });
}

/** Autocomplétion des communes (spec §7) : anti-rebond 250 ms, désactivée sous 2 caractères. */
export function useCommuneSearch(q: string) {
  const debounced = useDebouncedValue(q, 250);
  const trimmed = debounced.trim();

  return useQuery({
    queryKey: jobKeys.communes(trimmed),
    queryFn: () => searchCommunes(trimmed),
    enabled: trimmed.length >= 2,
  });
}
