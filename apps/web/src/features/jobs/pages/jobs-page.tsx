import type { CommuneDto, JobSearchQuery } from '@jobtrack/shared';
import { useQuery } from '@tanstack/react-query';
import { useEffect, useRef, useState } from 'react';
import { PageHeader } from '@/components/shared/page-header';
import { TooltipProvider } from '@/components/ui/tooltip';
import { profileKeys } from '@/features/profile/lib/query-keys';
import { fetchPreferences, type PreferencesDto } from '@/services/api/profile';
import { searchCommunes } from '@/services/api/jobs';
import { JobFilters } from '../components/job-filters';
import { JobList } from '../components/job-list';
import { JobSearchBar, type JobSearchSubmit } from '../components/job-search-bar';
import { JobSortSelect } from '../components/job-sort-select';
import { JobTabs } from '../components/job-tabs';
import { SyncBanner } from '../components/sync-banner';
import { useJobSearch } from '../hooks/use-jobs';
import { isDefaultQuery, useJobSearchParams } from '../lib/search-params';

type CommuneMap = Record<string, CommuneDto>;

/** Libellé de repli quand une commune de l'URL n'a pas encore été résolue (spec §7 : pas de lookup par code côté API). */
function fallbackCommune(code: string): CommuneDto {
  return { code, name: `Commune ${code}`, postalCode: null, departmentCode: code.slice(0, 2) };
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

  const patch: Partial<JobSearchQuery> = { distance: preferences.searchRadiusKm };

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

function subtitleFor(isPending: boolean, total: number | undefined): string {
  if (isPending) return 'Recherche en cours…';
  if (!total) return 'Aucune offre trouvée.';
  return `${total} offre${total > 1 ? 's' : ''} trouvée${total > 1 ? 's' : ''} dans votre zone de recherche.`;
}

export function JobsPage() {
  const [query, setQuery] = useJobSearchParams();
  const [communeMap, setCommuneMap] = useState<CommuneMap>({});
  const [forceRefresh, setForceRefresh] = useState(false);
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

  const effectiveQuery: JobSearchQuery = { ...query, refresh: forceRefresh };
  const searchResult = useJobSearch(effectiveQuery);

  // Le rafraîchissement forcé ne vit jamais dans l'URL (spec §7) : une fois la requête posée
  // (succès ou échec), on revient à `refresh: false` pour que les recherches suivantes
  // retrouvent le cache normal.
  useEffect(() => {
    if (forceRefresh && !searchResult.isFetching) setForceRefresh(false);
  }, [forceRefresh, searchResult.isFetching]);

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

  return (
    <TooltipProvider>
      <div className="mx-auto max-w-5xl">
        <PageHeader title="Offres d'emploi" description={subtitleFor(searchResult.isPending, total)} />

        <div className="space-y-4">
          <JobSearchBar
            q={query.q}
            distance={query.distance}
            communes={resolvedCommunes}
            onCommunesResolved={handleCommunesResolved}
            onSearch={handleSearch}
          />

          <div className="flex flex-wrap items-center justify-between gap-3">
            <JobFilters
              value={{
                contractTypes: query.contractTypes,
                remoteModes: query.remoteModes,
                experienceLevels: query.experienceLevels,
                salaryMin: query.salaryMin,
                publishedWithinDays: query.publishedWithinDays,
                sources: query.sources,
              }}
              onChange={(patch) => setQuery(patch)}
            />
            <JobSortSelect value={query.sort} onChange={(sort) => setQuery({ sort })} />
          </div>

          <div className="flex flex-wrap items-center justify-between gap-3">
            <JobTabs value={query.tab} onChange={(tab) => setQuery({ tab })} />
            {searchResult.data && (
              <SyncBanner sync={searchResult.data.sync} onRefresh={() => setForceRefresh(true)} refreshing={forceRefresh} />
            )}
          </div>

          <JobList
            data={searchResult.data}
            isPending={searchResult.isPending}
            isError={searchResult.isError}
            isPlaceholderData={searchResult.isPlaceholderData}
            onRetry={() => void searchResult.refetch()}
            onPageChange={handlePageChange}
            onResetFilters={handleResetFilters}
          />
        </div>
      </div>
    </TooltipProvider>
  );
}
