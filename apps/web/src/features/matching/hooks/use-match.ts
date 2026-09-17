import type { AnalyzeJobsResponseDto, JobListResponseDto, MatchScoreDto } from '@jobtrack/shared';
import { useMutation, useQuery, useQueryClient, type QueryClient } from '@tanstack/react-query';
import { useEffect, useRef, useState } from 'react';
import { analyzeJobs, fetchJobMatch, retryJobAnalysis } from '@/services/api/matching';
import { matchKeys } from '../lib/query-keys';

// Préfixe commun à toutes les clés `jobKeys.search(...)` (`features/jobs/lib/query-keys.ts`) :
// cible d'un `setQueriesData` portant sur « toutes les listes en cache », sans
// connaître les paramètres de chacune (même principe que `use-jobs.ts`).
const SEARCH_PREFIX = ['jobs', 'search'] as const;

/**
 * Répercute la réponse de `POST /jobs/analyses` dans le cache TanStack Query :
 * chaque liste de recherche en cache reçoit le score à jour pour les offres
 * concernées (`item.match = scores[id] ?? item.match`, une offre absente de la
 * réponse ou dont le score est encore `null` garde son état précédent), et le
 * score détaillé déjà en cache (`matchKeys.detail`) reçoit les mêmes champs
 * sommaires — les champs propres au détail (facteurs, statut d'analyse...)
 * restent ceux déjà en cache jusqu'au prochain `GET /jobs/:id/match`.
 */
function mergeAnalyzeScoresIntoCache(queryClient: QueryClient, scores: AnalyzeJobsResponseDto['scores']): void {
  queryClient.setQueriesData<JobListResponseDto>({ queryKey: SEARCH_PREFIX }, (old) => {
    if (!old) return old;
    return {
      ...old,
      items: old.items.map((item) => ({ ...item, match: scores[item.id] ?? item.match })),
    };
  });

  for (const [jobId, score] of Object.entries(scores)) {
    if (!score) continue;
    queryClient.setQueryData<MatchScoreDto>(matchKeys.detail(jobId), (old) => (old ? { ...old, ...score } : old));
  }
}

/** `GET /jobs/:id/match` : score détaillé, recalculé côté serveur si l'empreinte du profil a changé. */
export function useJobMatch(id: string, options: { enabled?: boolean } = {}) {
  return useQuery({
    queryKey: matchKeys.detail(id),
    queryFn: () => fetchJobMatch(id),
    enabled: options.enabled,
    // Le score dépend du profil et des offres déjà analysées, pas d'un flux
    // temps réel : une minute évite une revalidation à chaque focus de fenêtre
    // pendant qu'un panneau de détail reste ouvert.
    staleTime: 60_000,
  });
}

/**
 * `POST /jobs/analyses` (spec §2/§6) : lance l'analyse des offres manquantes et
 * calcule les scores, puis répercute la réponse dans tout le cache concerné
 * (`mergeAnalyzeScoresIntoCache`). Expose un état dérivé de la dernière réponse
 * plutôt que le seul statut de la mutation : `pending`/`notConfigured`/
 * `profileComplete` pilotent l'affichage (bannière IA non configurée, profil
 * incomplet) sans que l'appelant ait à relire `mutation.data` lui-même.
 */
export function useAnalyzeJobs() {
  const queryClient = useQueryClient();

  const mutation = useMutation({
    mutationFn: (jobIds: string[]) => analyzeJobs(jobIds),
    onSuccess: (data) => {
      mergeAnalyzeScoresIntoCache(queryClient, data.scores);
    },
  });

  return {
    analyze: (jobIds: string[]) => mutation.mutate(jobIds),
    analyzeAsync: (jobIds: string[]) => mutation.mutateAsync(jobIds),
    isAnalyzing: mutation.isPending,
    pending: mutation.data?.pending ?? 0,
    notConfigured: mutation.data?.notConfigured ?? false,
    profileComplete: mutation.data?.profileComplete ?? true,
    error: mutation.error,
  };
}

const POLL_INTERVAL_MS = 2_000;
const POLL_MAX_MS = 60_000;

export interface AnalysisPollingState {
  isAnalyzing: boolean;
  pending: number;
  notConfigured: boolean;
  profileComplete: boolean;
  error: Error | null;
}

const IDLE_STATE: AnalysisPollingState = {
  isAnalyzing: false,
  pending: 0,
  notConfigured: false,
  profileComplete: true,
  error: null,
};

/**
 * Interroge `POST /jobs/analyses` toutes les 2 s tant que la dernière réponse
 * portait `pending > 0`, pendant 60 s au plus (spec §2/§7 : l'analyse tourne
 * côté serveur, le client se contente de revenir la constater). Un budget de
 * temps écoulé plutôt qu'un nombre d'essais fixe : l'intervalle est constant
 * (2 s) donc les deux se valent ici, mais un budget de temps reste correct si
 * l'intervalle change un jour. Le sondage s'arrête si le composant appelant
 * est démonté (nettoyage de l'effet) ou si la liste d'identifiants est vide.
 */
export function useAnalysisPolling(jobIds: string[]): AnalysisPollingState {
  const queryClient = useQueryClient();
  const [state, setState] = useState<AnalysisPollingState>(IDLE_STATE);
  // La liste change de référence à chaque rendu du composant appelant (souvent
  // `.map(...).filter(...)` en ligne) : une clé stable (identifiants triés,
  // joints) évite de relancer le sondage à chaque rendu alors que le contenu
  // n'a pas changé.
  const jobIdsKey = [...jobIds].sort().join(',');
  const jobIdsRef = useRef(jobIds);
  jobIdsRef.current = jobIds;

  useEffect(() => {
    const ids = jobIdsRef.current;
    if (ids.length === 0) {
      setState(IDLE_STATE);
      return;
    }

    let cancelled = false;
    let elapsedMs = 0;
    let timer: ReturnType<typeof setTimeout> | undefined;

    async function poll(): Promise<void> {
      setState((previous) => ({ ...previous, isAnalyzing: true }));
      try {
        const response = await analyzeJobs(ids);
        if (cancelled) return;
        mergeAnalyzeScoresIntoCache(queryClient, response.scores);
        setState({
          isAnalyzing: false,
          pending: response.pending,
          notConfigured: response.notConfigured,
          profileComplete: response.profileComplete,
          error: null,
        });
        if (response.pending > 0 && elapsedMs < POLL_MAX_MS) {
          elapsedMs += POLL_INTERVAL_MS;
          timer = setTimeout(() => void poll(), POLL_INTERVAL_MS);
        }
      } catch (error) {
        if (cancelled) return;
        setState((previous) => ({
          ...previous,
          isAnalyzing: false,
          error: error instanceof Error ? error : new Error('Une erreur est survenue. Veuillez réessayer.'),
        }));
      }
    }

    void poll();

    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
    // Dépendances volontairement limitées à `jobIdsKey` (contenu stable) et
    // `queryClient` : `jobIdsRef.current`, lu au déclenchement de l'effet,
    // porte la liste réelle sans provoquer un nouveau sondage à chaque rendu.
  }, [jobIdsKey, queryClient]);

  return state;
}

/**
 * `POST /jobs/:id/analyses/retry` (spec §6) : relance une analyse `FAILED`.
 * Invalide `matchKeys.detail(id)` plutôt que de mettre à jour le cache
 * localement — la réponse ne porte aucun score, seul un nouveau
 * `GET /jobs/:id/match` peut refléter le nouveau statut (`pending`, `done`…).
 */
export function useRetryJobAnalysis(id: string) {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: () => retryJobAnalysis(id),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: matchKeys.detail(id) });
    },
  });
}
