import type { ApplicationTab } from '@jobtrack/shared';
import { APPLICATION_TAB_VALUES } from '@jobtrack/shared';
import { useCallback, useEffect, useMemo, useRef } from 'react';
import { useSearchParams } from 'react-router-dom';

/**
 * Clés d'URL de `/applications` (spec §7), en français comme le reste des
 * écrans : `?vue=table|kanban`, `?onglet=`, `?q=`, `?page=`,
 * `?candidature=<id>`, `?ajouter=1`.
 */
export const APPLICATIONS_PARAM_KEYS = {
  view: 'vue',
  tab: 'onglet',
  q: 'q',
  page: 'page',
  application: 'candidature',
  add: 'ajouter',
} as const;

export const APPLICATION_VIEWS = ['table', 'kanban'] as const;
export type ApplicationsView = (typeof APPLICATION_VIEWS)[number];

/** Bornes reprises du contrat partagé (`applicationListQuerySchema`, `q` ≤ 120 ; identifiants ≤ 64). */
const MAX_QUERY_LENGTH = 120;
const MAX_ID_LENGTH = 64;

export interface ApplicationsUrlState {
  view: ApplicationsView;
  tab: ApplicationTab;
  /** Recherche texte, `''` quand aucune (jamais `undefined` : le champ contrôlé en a toujours une). */
  q: string;
  page: number;
  /** Candidature dont le panneau de détail est ouvert, `null` sinon. */
  applicationId: string | null;
  /** `?ajouter=1` : le formulaire de création est ouvert. */
  adding: boolean;
}

export const DEFAULT_APPLICATIONS_URL_STATE: ApplicationsUrlState = {
  view: 'table',
  tab: 'all',
  q: '',
  page: 1,
  applicationId: null,
  adding: false,
};

function isApplicationsView(value: string | null): value is ApplicationsView {
  return value !== null && APPLICATION_VIEWS.some((view) => view === value);
}

function isApplicationTab(value: string | null): value is ApplicationTab {
  return value !== null && APPLICATION_TAB_VALUES.some((tab) => tab === value);
}

/**
 * Numéro de page lu depuis l'URL : toute valeur non entière, négative, nulle
 * ou absente retombe sur 1 — jamais une page que `applicationListQuerySchema`
 * refuserait ensuite côté serveur.
 */
function readPage(raw: string | null): number {
  if (raw === null) return 1;
  const parsed = Number(raw);
  if (!Number.isInteger(parsed) || parsed < 1) return 1;
  return parsed;
}

/**
 * Lit l'état de `/applications` depuis une chaîne de requête. Toute valeur
 * invalide (`?vue=grille`, `?onglet=inconnu`, `?page=abc`, recherche ou
 * identifiant trop long) est ramenée dans les bornes plutôt que propagée :
 * l'écriture qui suit (`useApplicationsUrlState`) réécrit alors l'URL avec la
 * valeur corrigée.
 */
export function readApplicationsUrlState(params: URLSearchParams): ApplicationsUrlState {
  const rawView = params.get(APPLICATIONS_PARAM_KEYS.view);
  const rawTab = params.get(APPLICATIONS_PARAM_KEYS.tab);
  const rawApplication = params.get(APPLICATIONS_PARAM_KEYS.application);

  return {
    view: isApplicationsView(rawView) ? rawView : 'table',
    tab: isApplicationTab(rawTab) ? rawTab : 'all',
    q: (params.get(APPLICATIONS_PARAM_KEYS.q) ?? '').slice(0, MAX_QUERY_LENGTH),
    page: readPage(params.get(APPLICATIONS_PARAM_KEYS.page)),
    applicationId: rawApplication !== null && rawApplication !== '' ? rawApplication.slice(0, MAX_ID_LENGTH) : null,
    adding: params.get(APPLICATIONS_PARAM_KEYS.add) === '1',
  };
}

/**
 * Écrit `state` dans `base` (les paramètres étrangers à cet écran sont
 * conservés tels quels) : chaque valeur égale à son défaut est retirée de
 * l'URL plutôt qu'écrite, comme `toJobSearchParams` le fait pour la recherche
 * d'offres — une URL « propre » ne porte que ce que l'utilisateur a
 * réellement choisi.
 */
export function applyApplicationsUrlState(base: URLSearchParams, state: ApplicationsUrlState): URLSearchParams {
  const params = new URLSearchParams(base);

  const set = (key: string, value: string | null): void => {
    if (value === null || value === '') params.delete(key);
    else params.set(key, value);
  };

  set(APPLICATIONS_PARAM_KEYS.view, state.view === 'table' ? null : state.view);
  set(APPLICATIONS_PARAM_KEYS.tab, state.tab === 'all' ? null : state.tab);
  set(APPLICATIONS_PARAM_KEYS.q, state.q.slice(0, MAX_QUERY_LENGTH));
  set(APPLICATIONS_PARAM_KEYS.page, state.page > 1 ? String(state.page) : null);
  set(APPLICATIONS_PARAM_KEYS.application, state.applicationId);
  set(APPLICATIONS_PARAM_KEYS.add, state.adding ? '1' : null);

  return params;
}

/** Sérialisation autonome (sans paramètre étranger), utilisée pour les `href` de pagination. */
export function writeApplicationsUrlState(state: ApplicationsUrlState): URLSearchParams {
  return applyApplicationsUrlState(new URLSearchParams(), state);
}

export interface SetApplicationsUrlStateOptions {
  /**
   * Remet `page` à 1. Par défaut : `true`, sauf quand `patch` porte lui-même
   * `page` (changement de page explicite) — même règle que
   * `useJobSearchParams`.
   */
  resetPage?: boolean;
}

export type SetApplicationsUrlState = (
  patch: Partial<ApplicationsUrlState>,
  options?: SetApplicationsUrlStateOptions,
) => void;

/**
 * État de `/applications` porté par l'URL (spec §7). Toutes les écritures
 * remplacent l'entrée d'historique courante (`{ replace: true }`) : filtrer,
 * paginer ou ouvrir une fiche ne doit pas transformer le bouton « Précédent »
 * du navigateur en annulation pas-à-pas des derniers clics — il ramène à
 * l'écran d'où l'on vient.
 *
 * Un effet normalise l'URL au montage et après toute navigation externe : une
 * valeur invalide (`?vue=grille`) est réécrite avec sa valeur corrigée plutôt
 * que simplement ignorée à la lecture, pour qu'un lien copié à ce moment-là
 * porte bien ce qui est affiché.
 *
 * La fusion n'utilise pas la forme fonctionnelle de `setSearchParams` (même
 * raison que `useJobSearchParams` : sous react-router 6.30 deux appels
 * rapprochés dans le même tick partiraient tous deux du même état). `paramsRef`
 * garde la dernière valeur posée.
 */
export function useApplicationsUrlState(): [ApplicationsUrlState, SetApplicationsUrlState] {
  const [searchParams, setSearchParams] = useSearchParams();
  const state = useMemo(() => readApplicationsUrlState(searchParams), [searchParams]);

  const paramsRef = useRef(searchParams);
  paramsRef.current = searchParams;

  const setState = useCallback<SetApplicationsUrlState>(
    (patch, options = {}) => {
      const current = readApplicationsUrlState(paramsRef.current);
      const merged: ApplicationsUrlState = { ...current, ...patch };
      const resetPage = options.resetPage ?? !('page' in patch);
      if (resetPage) merged.page = 1;
      const nextParams = applyApplicationsUrlState(paramsRef.current, merged);
      paramsRef.current = nextParams;
      setSearchParams(nextParams, { replace: true });
    },
    [setSearchParams],
  );

  useEffect(() => {
    const canonical = applyApplicationsUrlState(searchParams, state);
    if (canonical.toString() === searchParams.toString()) return;
    paramsRef.current = canonical;
    setSearchParams(canonical, { replace: true });
  }, [searchParams, state, setSearchParams]);

  return [state, setState];
}
