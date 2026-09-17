import type { AnalyzeJobsResponseDto, JobListResponseDto, JobSummaryDto } from '@jobtrack/shared';
import { useMutation, useQuery, useQueryClient, type QueryClient } from '@tanstack/react-query';
import { useEffect, useRef, useState } from 'react';
import { ApiError } from '@/services/api/client';
import { analyzeJobs, fetchJobMatch, retryJobAnalysis } from '@/services/api/matching';
import { matchKeys } from '../lib/query-keys';

// Préfixe commun à toutes les clés `jobKeys.search(...)` (`features/jobs/lib/query-keys.ts`) :
// cible d'un `setQueriesData` portant sur « toutes les listes en cache », sans
// connaître les paramètres de chacune (même principe que `use-jobs.ts`).
const SEARCH_PREFIX = ['jobs', 'search'] as const;

/** Deux scores sommaires sont égaux champ à champ (jamais par référence : chaque réponse serveur crée de nouveaux objets). */
function sameMatch(a: JobSummaryDto['match'], b: JobSummaryDto['match']): boolean {
  if (a === b) return true;
  if (a === null || b === null) return false;
  return (
    a.score === b.score &&
    a.band === b.band &&
    a.priority === b.priority &&
    a.explanation.top.length === b.explanation.top.length &&
    a.explanation.weak.length === b.explanation.weak.length &&
    a.explanation.top.every((line, index) => line === b.explanation.top[index]) &&
    a.explanation.weak.every((line, index) => line === b.explanation.weak[index])
  );
}

/**
 * Applique les scores d'une réponse `POST /jobs/analyses` à une liste en
 * cache : seules les offres explicitement présentes dans `scores` sont
 * touchées (`Object.hasOwn`, pas `??`) — une offre absente de la réponse
 * (hors de la page analysée) garde son score précédent, tandis qu'une offre
 * présente avec un score `null` (données insuffisantes, profil incomplet…)
 * voit bien son `match` remis à `null` plutôt que de garder un ancien score
 * périmé. Les références sont préservées quand rien ne change (offre non
 * concernée ou score identique) : les cartes non concernées (`memo`,
 * `job-card.tsx`) ne se re-rendent pas.
 */
function mergeScoresIntoList(list: JobListResponseDto, scores: AnalyzeJobsResponseDto['scores']): JobListResponseDto {
  let changed = false;
  const items = list.items.map((item) => {
    if (!Object.hasOwn(scores, item.id)) return item;
    const nextMatch = scores[item.id] ?? null;
    if (sameMatch(item.match, nextMatch)) return item;
    changed = true;
    return { ...item, match: nextMatch };
  });
  return changed ? { ...list, items } : list;
}

/**
 * Répercute la réponse de `POST /jobs/analyses` dans le cache TanStack Query :
 * les listes de recherche reçoivent les scores sommaires (`mergeScoresIntoList`),
 * et le score détaillé déjà en cache (`matchKeys.detail`) est **invalidé**
 * plutôt que fusionné pour chaque offre analysée — la réponse ne porte que le
 * résumé (score/bande/priorité/explication), jamais les facteurs ni le statut
 * d'analyse détaillé ; les y fusionner laisserait `factors`/`analysis.status`
 * périmés en cache jusqu'au prochain `GET` explicite.
 */
function applyAnalyzeScores(queryClient: QueryClient, scores: AnalyzeJobsResponseDto['scores']): void {
  queryClient.setQueriesData<JobListResponseDto>({ queryKey: SEARCH_PREFIX }, (old) => (old ? mergeScoresIntoList(old, scores) : old));

  for (const jobId of Object.keys(scores)) {
    void queryClient.invalidateQueries({ queryKey: matchKeys.detail(jobId) });
  }
}

function isRateLimited(error: unknown): boolean {
  return error instanceof ApiError && error.status === 429;
}

function isAiNotConfigured(error: unknown): boolean {
  return error instanceof ApiError && error.code === 'AI_NOT_CONFIGURED';
}

/** Réponse synthétique quand l'IA n'est pas configurée (spec §2/§6) : jamais une erreur, un état à afficher. */
const NOT_CONFIGURED_RESPONSE: AnalyzeJobsResponseDto = {
  analyzed: 0,
  pending: 0,
  failed: 0,
  notConfigured: true,
  profileComplete: true,
  scores: {},
};

const RETRY_DELAY_MS = 4_000;

/**
 * `POST /jobs/analyses`, robuste (spec §6, revue) : `AI_NOT_CONFIGURED` (503)
 * n'est jamais une erreur côté appelant — il devient une réponse normale avec
 * `notConfigured: true`, pour que ni `useAnalyzeJobs` ni `useAnalysisPolling`
 * n'affichent de message d'erreur générique à la place du bandeau dédié. Un
 * 429 (`RATE_LIMITED`) est définitif pour cet appel : aucun réessai n'aurait
 * de sens avant l'expiration du seau. Toute autre panne (réseau, 500…) est
 * transitoire : un seul réessai après 4 s, puis abandon — jamais de boucle de
 * réessais indéfinie qui masquerait une vraie panne prolongée.
 */
async function runAnalyzeJobs(jobIds: string[]): Promise<AnalyzeJobsResponseDto> {
  try {
    return await analyzeJobs(jobIds);
  } catch (error) {
    if (isAiNotConfigured(error)) return NOT_CONFIGURED_RESPONSE;
    if (isRateLimited(error)) throw error;

    await new Promise((resolve) => setTimeout(resolve, RETRY_DELAY_MS));
    try {
      return await analyzeJobs(jobIds);
    } catch (retryError) {
      if (isAiNotConfigured(retryError)) return NOT_CONFIGURED_RESPONSE;
      throw retryError;
    }
  }
}

/**
 * `GET /jobs/:id/match` : score détaillé, recalculé côté serveur si l'empreinte
 * du profil a changé. `refetchInterval` reprend la main tant que le serveur
 * indique une analyse encore en cours (`analysis.status === 'pending'`,
 * typiquement juste après un déclenchement par un autre onglet/utilisateur) :
 * le panneau de détail se met à jour tout seul sans action de l'appelant.
 */
export function useJobMatch(id: string, options: { enabled?: boolean } = {}) {
  return useQuery({
    queryKey: matchKeys.detail(id),
    queryFn: () => fetchJobMatch(id),
    enabled: options.enabled,
    // Le score dépend du profil et des offres déjà analysées, pas d'un flux
    // temps réel : une minute évite une revalidation à chaque focus de fenêtre
    // pendant qu'un panneau de détail reste ouvert.
    staleTime: 60_000,
    refetchInterval: (query) => (query.state.data?.analysis.status === 'pending' ? 2_000 : false),
  });
}

/**
 * `POST /jobs/analyses` (spec §2/§6) : lance l'analyse des offres manquantes et
 * calcule les scores, puis répercute la réponse dans le cache (`applyAnalyzeScores`).
 * `pending` retombe à `0` sur une erreur (`mutation.isError`) plutôt que de
 * garder la dernière valeur connue de `mutation.data` : sans ce garde-fou, une
 * bannière de progression resterait affichée indéfiniment après un échec.
 *
 * `analyzeAsync` (en plus de `analyze`) est conservé pour `features/jobs`
 * (`jobs-page.tsx`, `job-detail-page.tsx`) : ces pages enchaînent une action
 * (tri par défaut, relecture du score détaillé) une fois l'analyse terminée,
 * ce que `mutate` (fire-and-forget) ne permet pas.
 */
export function useAnalyzeJobs() {
  const queryClient = useQueryClient();

  const mutation = useMutation({
    mutationFn: (jobIds: string[]) => runAnalyzeJobs(jobIds),
    onSuccess: (data) => {
      applyAnalyzeScores(queryClient, data.scores);
    },
  });

  return {
    analyze: (jobIds: string[]) => mutation.mutate(jobIds),
    analyzeAsync: (jobIds: string[]) => mutation.mutateAsync(jobIds),
    isAnalyzing: mutation.isPending,
    pending: mutation.isError ? 0 : (mutation.data?.pending ?? 0),
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
 * côté serveur, le client se contente de revenir la constater). `runAnalyzeJobs`
 * porte déjà la résilience par appel (503 → état, 429 → abandon immédiat,
 * panne transitoire → un réessai après 4 s) : cette boucle n'a donc qu'à
 * réagir au résultat final de chaque tour — sur une erreur qui en ressort
 * malgré tout (429, ou panne toujours là après le réessai), `pending` retombe
 * à `0` et le sondage s'arrête, jamais de programmation d'un tour de plus. Le
 * sondage s'arrête aussi si le composant appelant est démonté (nettoyage de
 * l'effet) ou si la liste d'identifiants est vide.
 */
export function useAnalysisPolling(jobIds: string[]): AnalysisPollingState {
  const queryClient = useQueryClient();
  const [state, setState] = useState<AnalysisPollingState>(IDLE_STATE);
  // La liste change de référence à chaque rendu du composant appelant (souvent
  // `.map(...).filter(...)` en ligne) : une clé stable (identifiants triés,
  // joints) évite de relancer le sondage à chaque rendu alors que le contenu
  // n'a pas changé. `jobIdsRef` porte la liste réelle à utiliser par l'effet
  // de sondage ; elle est tenue à jour par un effet séparé plutôt que pendant
  // le rendu (une écriture de ref pendant le rendu est un effet de bord que
  // React ne garantit pas de n'exécuter qu'une fois, notamment en mode strict).
  const jobIdsKey = [...jobIds].sort().join(',');
  const jobIdsRef = useRef<string[]>(jobIds);

  useEffect(() => {
    jobIdsRef.current = jobIds;
  }, [jobIds]);

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
        const response = await runAnalyzeJobs(ids);
        if (cancelled) return;
        applyAnalyzeScores(queryClient, response.scores);
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
          pending: 0,
          error: error instanceof Error ? error : new Error('Une erreur est survenue. Veuillez réessayer.'),
        }));
      }
    }

    void poll();

    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
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
