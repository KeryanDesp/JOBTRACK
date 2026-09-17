import type { CommuneDto, JobSearchQuery, JobSyncInfoDto } from '@jobtrack/shared';
import { useQuery } from '@tanstack/react-query';
import { AlertCircle } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { PageHeader } from '@/components/shared/page-header';
import { Alert, AlertTitle } from '@/components/ui/alert';
import { TooltipProvider } from '@/components/ui/tooltip';
import { AnalysisProgress } from '@/features/matching/components/analysis-progress';
import { IncompleteProfileNotice } from '@/features/matching/components/incomplete-profile-notice';
import { useAnalyzeJobs } from '@/features/matching/hooks/use-match';
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
 * `analyzed` vient de `sync.analysis.analyzed` (serveur) quand la page a
 * demandé une analyse, sinon du décompte local des offres déjà notées
 * (`match !== null`) — jamais recalculé autrement, pour rester cohérent avec
 * ce que `JobCard` affiche réellement.
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

  const analyzeJobs = useAnalyzeJobs();
  // `analyzeAsync` plutôt que `analyze` (fonction stable, capturée par une ref
  // comme `refreshRef`/`appliedPreferencesRef` ci-dessus) : on doit à la fois
  // déclencher l'analyse sans relister ce closure changeant à chaque rendu
  // dans les dépendances de l'effet, et lire la réponse exacte pour la
  // décision « Pertinence par défaut » plus bas — un simple `analyze()`
  // (mutation « fire-and-forget ») ne donnerait cette réponse qu'après un ou
  // plusieurs rendus supplémentaires (`isAnalyzing`/`notConfigured` sur le
  // hook), trop tard pour être lue de façon fiable dans le même effet.
  const analyzeAsyncRef = useRef(analyzeJobs.analyzeAsync);
  analyzeAsyncRef.current = analyzeJobs.analyzeAsync;
  // Dernière recherche connue (mise à jour à chaque rendu) : lue à la
  // résolution de l'analyse ci-dessous plutôt que `window.location.search`
  // (utilisé par la reprise des préférences plus haut) — `query` vient déjà
  // du routeur et reste donc correct quel que soit le routeur utilisé par les
  // tests (`MemoryRouter`, qui ne synchronise jamais `window.location`).
  const queryRef = useRef(query);
  queryRef.current = query;
  // Jeu d'ids de la dernière analyse déclenchée par cette page : évite de
  // rappeler `POST /jobs/analyses` en boucle quand le serveur continue de
  // renvoyer `match: null` pour les mêmes offres (IA non configurée, profil
  // incomplet — spec §7 : « une fois par jeu d'ids, pas en boucle »).
  const lastAnalyzedKeyRef = useRef<string | null>(null);
  // Décision « Pertinence par défaut » (ci-dessous) : prise au plus une fois,
  // à la toute première analyse déclenchée par cette page.
  const isFirstAnalysisRef = useRef(true);
  const appliedRelevanceDefaultRef = useRef(false);

  useEffect(() => {
    const items = searchResult.data?.items;
    if (!items || items.length === 0) return;
    const idsToAnalyze = items.filter((item) => item.match === null).map((item) => item.id);
    if (idsToAnalyze.length === 0) return;
    const key = [...idsToAnalyze].sort().join(',');
    if (lastAnalyzedKeyRef.current === key) return;
    lastAnalyzedKeyRef.current = key;

    const isFirstAnalysis = isFirstAnalysisRef.current;
    isFirstAnalysisRef.current = false;

    void analyzeAsyncRef
      .current(idsToAnalyze)
      .then((response) => {
        if (!isFirstAnalysis || appliedRelevanceDefaultRef.current) return;
        appliedRelevanceDefaultRef.current = true;
        // « Pertinence » ne devient le tri par défaut que si l'IA est
        // configurée et le profil complet (spec §2/§7) — sinon la recherche
        // garde « Plus récentes ». `queryRef.current` (plutôt que le `query`
        // fermé par cet effet) porte la toute dernière recherche : on
        // abandonne si elle a bougé pendant l'analyse (déjà modifiée par
        // l'utilisateur), jamais écrasée par ce choix de tri par défaut.
        if (response.notConfigured || !response.profileComplete) return;
        if (isDefaultQuery(queryRef.current)) setQuery({ sort: 'relevance' }, { replace: true });
      })
      .catch(() => {
        // Erreur déjà portée par `analyzeJobs.error` (rien d'autre à afficher ici).
      });
  }, [searchResult.data, setQuery]);

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
  // Décompte affiché dans le sous-titre et la barre de progression (spec §2) :
  // `sync.analysis` (serveur) prime quand disponible, sinon décompte local des
  // offres déjà notées — voir la docstring de `subtitleFor`.
  const items = searchResult.data?.items;
  const analyzedCount = searchResult.data?.sync.analysis?.analyzed ?? items?.filter((item) => item.match !== null).length ?? 0;
  const pendingAnalysisCount = items?.filter((item) => item.match === null).length ?? 0;
  const showAnalysisProgress = analyzeJobs.isAnalyzing || analyzeJobs.pending > 0;
  const analysisProgressCount = Math.max(pendingAnalysisCount, analyzeJobs.pending);
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

        {showAnalysisProgress && <AnalysisProgress count={analysisProgressCount} className="-mt-4 mb-4" />}

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

          {/* Une seule fois pour toute la page (spec §2/§4), jamais répété par carte. */}
          {analyzeJobs.notConfigured && (
            <Alert>
              <AlertCircle aria-hidden="true" />
              <AlertTitle>{analysisStatusMessage('ai_not_configured')}</AlertTitle>
            </Alert>
          )}
          {analyzeJobs.profileComplete === false && <IncompleteProfileNotice />}

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
