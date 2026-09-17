import type { CommuneDto, JobSearchQuery, JobSyncInfoDto } from '@jobtrack/shared';
import { JOB_SEARCH_PARAM_KEYS } from '@jobtrack/shared';
import { useQuery } from '@tanstack/react-query';
import { AlertCircle } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { PageHeader } from '@/components/shared/page-header';
import { Alert, AlertTitle } from '@/components/ui/alert';
import { TooltipProvider } from '@/components/ui/tooltip';
import { AnalysisProgress } from '@/features/matching/components/analysis-progress';
import { IncompleteProfileNotice } from '@/features/matching/components/incomplete-profile-notice';
import { useAnalysisPolling } from '@/features/matching/hooks/use-match';
import { analysisStatusMessage } from '@/features/matching/lib/format';
import { profileKeys } from '@/features/profile/lib/query-keys';
import { fetchPreferences, type PreferencesDto } from '@/services/api/profile';
import { searchCommunes } from '@/services/api/jobs';
import { hasActiveJobFilters, JobFilters } from '../components/job-filters';
import { JobList } from '../components/job-list';
import { JobSearchBar, RADIUS_OPTIONS, type JobSearchSubmit } from '../components/job-search-bar';
import { JobSortSelect } from '../components/job-sort-select';
import { JobTabs } from '../components/job-tabs';
import { SyncBanner } from '../components/sync-banner';
import { useJobSearch, useJobsCapabilities } from '../hooks/use-jobs';
import { isDefaultQuery, readJobSearchQuery, useJobSearchParams } from '../lib/search-params';

type CommuneMap = Record<string, CommuneDto>;

/**
 * Code département depuis un code commune INSEE : mêmes règles que l'API
 * (`apps/api/.../france-travail.mapper.ts`) — deux premiers caractères en
 * général (déjà `2A`/`2B` pour la Corse, le code commune les portant tels
 * quels), trois pour les DOM/TOM (`97x`/`98x`).
 */
function departmentCodeFromCommuneCode(code: string): string {
  const upper = code.toUpperCase();
  if (upper.startsWith('97') || upper.startsWith('98')) return upper.slice(0, 3);
  return upper.slice(0, 2);
}

/** Libellé de repli quand une commune de l'URL n'a pas encore été résolue (spec §7 : pas de lookup par code côté API). */
function fallbackCommune(code: string): CommuneDto {
  return { code, name: `Code INSEE ${code}`, postalCode: null, departmentCode: departmentCodeFromCommuneCode(code) };
}

/**
 * Rayon d'une préférence ramené aux bornes du contrat de recherche (0–100,
 * spec `packages/shared/src/jobs.ts`) puis à l'option de rayon la plus proche
 * (`RADIUS_OPTIONS`, `job-search-bar.tsx`) : un profil enregistré avant que
 * l'un ou l'autre soit resserré (ex. 200 km) ne doit jamais produire une URL
 * que `jobSearchQuerySchema` rejetterait, ni une valeur absente du sélecteur.
 */
function clampSearchRadius(km: number): number {
  const bounded = Math.min(Math.max(km, 0), 100);
  return RADIUS_OPTIONS.reduce((closest, option) => (Math.abs(option - bounded) < Math.abs(closest - bounded) ? option : closest));
}

/**
 * Requête par défaut dérivée des préférences du profil (spec §2/§7), résolue
 * côté web : mots-clés = premier poste recherché, lieux = jusqu'à trois
 * communes résolues (tolérant aux échecs individuels), reste des critères
 * copiés tels quels. `undefined` si les préférences ne portent rien
 * d'exploitable — la page garde alors ses valeurs par défaut.
 */
async function preferencesToQuery(
  preferences: PreferencesDto,
): Promise<{ patch: Partial<JobSearchQuery>; communes: CommuneDto[] } | undefined> {
  // Le rayon a toujours une valeur (défaut 10, comme la requête elle-même) : il ne compte
  // pas à lui seul comme un signal de préférences « non vides » — sans quoi un profil tout
  // juste créé écrirait systématiquement `distance` dans l'URL sans aucune autre intention.
  const hasSignal =
    preferences.desiredRoles.length > 0 ||
    preferences.locations.length > 0 ||
    preferences.contractTypes.length > 0 ||
    preferences.remoteModes.length > 0 ||
    Boolean(preferences.experienceLevel);
  if (!hasSignal) return undefined;

  const patch: Partial<JobSearchQuery> = { distance: clampSearchRadius(preferences.searchRadiusKm) };

  const firstRole = preferences.desiredRoles[0];
  if (firstRole) patch.q = firstRole;

  const locations = preferences.locations.slice(0, 3);
  const settled = await Promise.allSettled(locations.map((location) => searchCommunes(location)));
  const resolvedCommunes: CommuneDto[] = [];
  for (const result of settled) {
    if (result.status === 'fulfilled' && result.value[0]) resolvedCommunes.push(result.value[0]);
  }
  if (resolvedCommunes.length > 0) patch.communes = resolvedCommunes.map((commune) => commune.code);

  if (preferences.contractTypes.length > 0) patch.contractTypes = preferences.contractTypes;
  if (preferences.remoteModes.length > 0) patch.remoteModes = preferences.remoteModes;
  if (preferences.experienceLevel) patch.experienceLevels = [preferences.experienceLevel];

  return { patch, communes: resolvedCommunes };
}

// Bandeau « connecteur non configuré » (spec §2/§7) synthétisé côté web, avant
// même la première réponse de `GET /jobs` (voir `showCapabilitiesNotConfigured`
// dans `JobsPage`) : mêmes champs qu'un `sync` serveur pour que `SyncBanner`
// n'ait pas à distinguer les deux origines.
const NOT_CONFIGURED_SYNC: JobSyncInfoDto = { status: 'not_configured', syncedAt: null, message: null };

/**
 * Sous-titre de la liste (spec §2 : « 13 offres trouvées · 9 analysées »).
 * `analyzed` est un décompte purement local (`items.filter(match !== null).length`,
 * calculé par l'appelant) : le serveur ne renvoie aucun total d'analyse à
 * l'échelle de la page (`JobSyncInfoDto.analysis` reste toujours absent de
 * `GET /jobs` à ce jour), seule `JobCard` sait vraiment ce qui est affiché.
 */
function subtitleFor(isPending: boolean, total: number | undefined, analyzed: number): string {
  if (isPending) return 'Recherche en cours…';
  if (!total) return 'Aucune offre trouvée.';
  const offers = `${total} offre${total > 1 ? 's' : ''} trouvée${total > 1 ? 's' : ''}`;
  // Accord au pluriel dès que ce n'est pas exactement 1 (donc aussi pour 0, contrairement à
  // `total` ci-dessus qui ne peut jamais valoir 0 à ce stade) : « 0 analysées », pas « 0 analysée ».
  const analyzedLabel = `${analyzed} analysée${analyzed === 1 ? '' : 's'}`;
  return `${offers} · ${analyzedLabel}`;
}

export function JobsPage() {
  const [query, setQuery] = useJobSearchParams();
  const [communeMap, setCommuneMap] = useState<CommuneMap>({});
  const [refreshing, setRefreshing] = useState(false);
  const refreshRef = useRef(false);
  const appliedPreferencesRef = useRef(false);

  // Drapeau pris au tout premier rendu (spec §2/§7, revue) : l'URL portait-elle déjà un tri
  // explicite (`?tri=...`), y compris `recent` ? Un lecteur externe (`useSearchParams`, distinct
  // de l'abstraction `useJobSearchParams` ci-dessous mais reflétant le même routeur) plutôt que
  // `window.location.search`, qui ne reflète jamais l'état d'un `MemoryRouter` (tests). Un
  // initialiseur paresseux de `useState` ne s'exécute qu'une fois : la valeur reste celle du
  // montage même quand l'URL change ensuite (bascule de tri manuelle, reprise des préférences).
  const [initialSearchParams] = useSearchParams();
  const [hadExplicitSortAtMount] = useState(() => initialSearchParams.has(JOB_SEARCH_PARAM_KEYS.sort));

  const preferencesQuery = useQuery({ queryKey: profileKeys.preferences, queryFn: fetchPreferences });

  // Première visite sans paramètres d'URL (spec §2/§7) : reprend les préférences une seule
  // fois. Un lien partagé (URL déjà porteuse de critères) n'est jamais écrasé.
  useEffect(() => {
    if (appliedPreferencesRef.current) return;
    if (!isDefaultQuery(query)) {
      appliedPreferencesRef.current = true;
      return;
    }
    if (preferencesQuery.isPending) return;
    appliedPreferencesRef.current = true;

    if (!preferencesQuery.data) return;
    void preferencesToQuery(preferencesQuery.data).then((result) => {
      if (!result) return;
      // La résolution des communes est asynchrone (spec §7) : pendant son attente,
      // l'utilisateur a pu taper sa propre recherche. On relit l'URL réelle plutôt que
      // la fermeture (potentiellement périmée) de `query`, et on abandonne si elle a
      // bougé — jamais écraser une saisie faite pendant que ce calcul tournait encore.
      const currentQuery = readJobSearchQuery(new URLSearchParams(window.location.search));
      if (!isDefaultQuery(currentQuery)) return;

      if (result.communes.length > 0) {
        setCommuneMap((previous) => {
          const merged = { ...previous };
          for (const commune of result.communes) merged[commune.code] = commune;
          return merged;
        });
      }
      setQuery(result.patch, { replace: true });
    });
  }, [preferencesQuery.isPending, preferencesQuery.data, query, setQuery]);

  const searchResult = useJobSearch(query, { refreshRef });
  const capabilitiesQuery = useJobsCapabilities();
  // Avant la toute première réponse de `GET /jobs` (spec §2/§7), le bandeau
  // « connecteur non configuré » n'a normalement rien à afficher : il n'y a pas
  // encore de `sync.status` serveur à lire. `useJobsCapabilities` (résolu
  // indépendamment, avec son propre cache) permet de l'annoncer immédiatement
  // quand le serveur sait déjà que France Travail n'est pas configuré, plutôt
  // que d'attendre une recherche qui de toute façon renverra ce même statut.
  const showCapabilitiesNotConfigured = !searchResult.data && capabilitiesQuery.data?.sources.franceTravail === false;

  // Dernière recherche connue (mise à jour à chaque rendu) : lue depuis les effets ci-dessous
  // plutôt que `window.location.search` (utilisé par la reprise des préférences plus haut) —
  // `query` vient déjà du routeur et reste donc correct quel que soit le routeur utilisé par
  // les tests (`MemoryRouter`, qui ne synchronise jamais `window.location`).
  const queryRef = useRef(query);
  queryRef.current = query;

  // Bandeaux IA non configurée / profil incomplet (spec §2/§4, revue) : hissés au niveau page
  // plutôt que dérivés d'une mutation ponctuelle — un onglet « Pour vous »/« Forte priorité »
  // sans offre à analyser (0 résultat, ou déjà toutes notées) ne relance jamais l'analyse, et
  // une valeur dérivée d'une mutation retomberait alors à ses défauts (« configuré », « profil
  // complet ») au lieu de garder ce qui a déjà été appris sur un autre onglet. `profileComplete`
  // démarre `null` (inconnu) : aucun bandeau tant qu'aucune réponse ne l'a jamais confirmé.
  const [notConfigured, setNotConfigured] = useState(false);
  const [profileComplete, setProfileComplete] = useState<boolean | null>(null);

  // Chemin rapide (revue, point 3) : si au moins une offre de la page courante porte déjà un
  // score, le profil était forcément complet et l'IA forcément configurée au moment de ce
  // calcul (le serveur ne score jamais pour un profil incomplet ou sans IA) — jamais besoin
  // d'attendre une analyse pour le savoir, y compris quand plus aucune offre n'a besoin d'être
  // analysée (`idsToAnalyze` vide ci-dessous).
  useEffect(() => {
    const items = searchResult.data?.items;
    if (items?.some((item) => item.match !== null)) setProfileComplete(true);
  }, [searchResult.data]);

  // Ids à analyser pour la page courante, jamais renvoyés une seconde fois pour un même jeu
  // (spec §7 : « une fois par jeu d'ids, pas en boucle ») : `seenIdSetKeysRef` mémorise chaque
  // jeu déjà transmis à `useAnalysisPolling` (un `Set`, pas une seule dernière clé — un
  // aller-retour entre deux onglets ne doit pas relancer l'analyse du premier). Remis à vide
  // dès que la page courante n'a plus rien à faire analyser (nouvel onglet, tout déjà noté) :
  // `useAnalysisPolling([])` s'arrête alors tout seul plutôt que de continuer à sonder des
  // offres qui ne sont plus affichées.
  const seenIdSetKeysRef = useRef<Set<string>>(new Set());
  const [idsToAnalyze, setIdsToAnalyze] = useState<string[]>([]);

  useEffect(() => {
    const items = searchResult.data?.items ?? [];
    const nullMatchIds = items.filter((item) => item.match === null).map((item) => item.id);
    if (nullMatchIds.length === 0) {
      setIdsToAnalyze((previous) => (previous.length === 0 ? previous : []));
      return;
    }
    const key = [...nullMatchIds].sort().join(',');
    if (seenIdSetKeysRef.current.has(key)) return;
    seenIdSetKeysRef.current.add(key);
    setIdsToAnalyze(nullMatchIds);
  }, [searchResult.data]);

  // `useAnalysisPolling` (plutôt qu'un unique appel `analyzeAsync`, revue point 1) : les offres
  // encore `PENDING` côté serveur (fil d'attente Claude) sont re-sondées toutes les 2 s jusqu'à
  // 60 s, jusqu'à ce que `pending` retombe à 0 — la barre de progression disparaît alors
  // vraiment, plutôt que de rester figée après le tout premier aller-retour.
  const polling = useAnalysisPolling(idsToAnalyze);

  // Détection d'une nouvelle réponse pour figer `notConfigured`/`profileComplete` : comparaison
  // de référence sur l'état renvoyé par `useAnalysisPolling`, jamais un front descendant de
  // `isAnalyzing` — React 18 peut fusionner en un seul rendu le passage « en cours » → « réponse
  // reçue » quand la promesse se résout via de purs microtasks (mocks de test, réponse déjà en
  // cache...), sans jamais rendre l'état intermédiaire `isAnalyzing: true` observable ici. Chaque
  // réponse de `useAnalysisPolling` (y compris un retour à son état de repos) est un nouvel objet
  // : sa seule référence suffit à détecter un changement réel, sans dépendre du minutage des
  // rendus. `idsToAnalyze.length > 0` exclut la remise au repos que `useAnalysisPolling`
  // déclenche elle-même quand ce jeu redevient vide (changement d'onglet) — jamais une réponse
  // serveur, elle ne doit jamais écraser ce qui a déjà été appris.
  const previousPollingRef = useRef(polling);
  useEffect(() => {
    if (idsToAnalyze.length > 0 && previousPollingRef.current !== polling) {
      setNotConfigured(polling.notConfigured);
      setProfileComplete(polling.profileComplete);
    }
    previousPollingRef.current = polling;
  }, [idsToAnalyze, polling]);

  // « Pertinence » par défaut (spec §2/§7, revue) : jamais si l'URL initiale portait déjà un
  // tri explicite, ni si l'utilisateur a changé le tri entre-temps (`queryRef.current.sort`,
  // relu à la résolution plutôt que fermé par l'effet) ; seulement si l'IA est configurée et le
  // profil complet. Séquencé après la reprise des préférences (`appliedPreferencesRef`) pour ne
  // jamais lui disputer le même `setQuery` : elle ne touche jamais `sort`, donc pas de fusion
  // nécessaire ici — un second `setQuery({ sort: 'relevance' })` derrière le sien suffit et
  // préserve tout ce qu'elle a déjà posé (mots-clés, lieux...). Ne s'applique qu'une fois.
  const appliedRelevanceDefaultRef = useRef(false);
  useEffect(() => {
    if (appliedRelevanceDefaultRef.current) return;
    if (!appliedPreferencesRef.current) return;
    if (hadExplicitSortAtMount || queryRef.current.sort !== 'recent') {
      appliedRelevanceDefaultRef.current = true;
      return;
    }
    if (profileComplete === null) return;
    appliedRelevanceDefaultRef.current = true;
    if (!notConfigured && profileComplete) setQuery({ sort: 'relevance' }, { replace: true });
    // `preferencesQuery.isPending` : ré-évalue cet effet une fois la reprise des préférences
    // réglée, y compris quand `profileComplete`/`notConfigured` sont déjà connus avant elle
    // (chemin rapide très précoce) — sans cette dépendance, un tel cas ne redéclencherait
    // jamais cet effet après coup, puisque `appliedPreferencesRef` (une ref) n'est pas réactive.
  }, [profileComplete, notConfigured, preferencesQuery.isPending, hadExplicitSortAtMount, setQuery]);

  function handleRefresh() {
    refreshRef.current = true;
    setRefreshing(true);
    void searchResult.refetch().finally(() => setRefreshing(false));
  }

  const resolvedCommunes = query.communes.map((code) => communeMap[code] ?? fallbackCommune(code));

  function handleCommunesResolved(next: CommuneDto[]) {
    setCommuneMap((previous) => {
      const merged = { ...previous };
      for (const commune of next) merged[commune.code] = commune;
      return merged;
    });
  }

  function handleSearch(submit: JobSearchSubmit) {
    setQuery({ q: submit.q, distance: submit.distance, communes: submit.communes });
  }

  function handleResetFilters() {
    setQuery({
      contractTypes: [],
      remoteModes: [],
      experienceLevels: [],
      salaryMin: undefined,
      publishedWithinDays: undefined,
      sources: [],
    });
  }

  function handlePageChange(page: number) {
    window.scrollTo({ top: 0 });
    setQuery({ page });
  }

  const total = searchResult.data?.total;
  // Décompte purement local (voir la docstring de `subtitleFor`).
  const analyzedCount = searchResult.data?.items.filter((item) => item.match !== null).length ?? 0;
  // Compte le jeu d'ids réellement transmis à `useAnalysisPolling` (revue, point 1) — jamais un
  // décompte dérivé de `searchResult.data`, qui varie au fil des réponses reçues.
  const showAnalysisProgress = polling.isAnalyzing || polling.pending > 0;
  const filterValues = {
    contractTypes: query.contractTypes,
    remoteModes: query.remoteModes,
    experienceLevels: query.experienceLevels,
    salaryMin: query.salaryMin,
    publishedWithinDays: query.publishedWithinDays,
    sources: query.sources,
  };
  const activeFilters = hasActiveJobFilters(filterValues);

  return (
    <TooltipProvider>
      <div className="mx-auto max-w-5xl">
        <PageHeader title="Offres d'emploi" description={subtitleFor(searchResult.isPending, total, analyzedCount)} />

        {showAnalysisProgress && <AnalysisProgress count={idsToAnalyze.length} className="-mt-4 mb-4" />}

        <div className="space-y-4">
          <JobSearchBar
            q={query.q}
            distance={query.distance}
            communes={resolvedCommunes}
            onCommunesResolved={handleCommunesResolved}
            onSearch={handleSearch}
          />

          <div className="flex flex-wrap items-center justify-between gap-3">
            <JobFilters value={filterValues} onChange={(patch, options) => setQuery(patch, options)} />
            <JobSortSelect value={query.sort} onChange={(sort) => setQuery({ sort })} />
          </div>

          <div className="flex flex-wrap items-center justify-between gap-3">
            <JobTabs value={query.tab} onChange={(tab) => setQuery({ tab })} />
            {searchResult.data ? (
              <SyncBanner sync={searchResult.data.sync} onRefresh={handleRefresh} refreshing={refreshing} />
            ) : (
              showCapabilitiesNotConfigured && (
                <SyncBanner sync={NOT_CONFIGURED_SYNC} onRefresh={handleRefresh} refreshing={refreshing} />
              )
            )}
          </div>

          {/* Une seule fois pour toute la page (spec §2/§4), jamais répété par carte — et visibles
              même sur « Pour vous »/« Forte priorité » à 0 résultat (état hissé au niveau page). */}
          {notConfigured && (
            <Alert>
              <AlertCircle aria-hidden="true" />
              <AlertTitle>{analysisStatusMessage('ai_not_configured')}</AlertTitle>
            </Alert>
          )}
          {profileComplete === false && <IncompleteProfileNotice />}

          <JobList
            data={searchResult.data}
            query={query}
            isPending={searchResult.isPending}
            isError={searchResult.isError}
            error={searchResult.error}
            isPlaceholderData={searchResult.isPlaceholderData}
            onRetry={() => void searchResult.refetch()}
            onPageChange={handlePageChange}
            onResetFilters={activeFilters ? handleResetFilters : undefined}
          />
        </div>
      </div>
    </TooltipProvider>
  );
}
