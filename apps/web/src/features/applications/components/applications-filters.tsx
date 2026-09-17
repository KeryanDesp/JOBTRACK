import type { ApplicationSort, ApplicationTab } from '@jobtrack/shared';
import {
  APPLICATION_SORT_LABELS,
  APPLICATION_SORT_VALUES,
  APPLICATION_TAB_LABELS,
  APPLICATION_TAB_VALUES,
  applicationTabToStatus,
} from '@jobtrack/shared';
import { KanbanSquare, Rows3, Search } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Skeleton } from '@/components/ui/skeleton';
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { useApplicationStats } from '../hooks/use-applications';
import type { ApplicationsView } from '../lib/url-state';
import { AddApplicationButton } from './add-application-button';

/** Délai avant de porter la recherche dans l'URL (spec §7) : une frappe continue ne relance pas une requête par caractère. */
const SEARCH_DEBOUNCE_MS = 300;

interface ApplicationsFiltersProps {
  tab: ApplicationTab;
  q: string;
  view: ApplicationsView;
  /** Tri de la vue table (`?tri=`, spec §7). */
  sort: ApplicationSort;
  onTabChange: (tab: ApplicationTab) => void;
  onQueryChange: (q: string) => void;
  onViewChange: (view: ApplicationsView) => void;
  onSortChange: (sort: ApplicationSort) => void;
  onAdd: () => void;
}

/**
 * Onglets + recherche + bascule de vue + action principale (spec §2/§7).
 *
 * Les compteurs viennent de `GET /applications/stats` (cahier des charges §55 :
 * jamais de nombre inventé) ; tant qu'ils ne sont pas connus, chaque onglet
 * affiche un petit squelette rond à la place du nombre plutôt qu'un zéro qui
 * serait faux. Une erreur de `stats` n'est pas bloquante : les onglets restent
 * utilisables, simplement sans compteur.
 */
export function ApplicationsFilters({
  tab,
  q,
  view,
  sort,
  onTabChange,
  onQueryChange,
  onViewChange,
  onSortChange,
  onAdd,
}: ApplicationsFiltersProps) {
  const stats = useApplicationStats();
  const [draft, setDraft] = useState(q);
  const timerRef = useRef<ReturnType<typeof setTimeout>>(undefined);
  // Dernière valeur réellement transmise au parent : sert à distinguer un
  // changement de `q` venu d'ailleurs (« Effacer les filtres », lien partagé)
  // d'un simple retour de notre propre écriture — seul le premier doit
  // réécrire le champ en cours de saisie.
  const lastEmittedRef = useRef(q);

  useEffect(() => {
    if (q === lastEmittedRef.current) return;
    // Un changement venu d'ailleurs (« Effacer les filtres », navigation vers
    // un lien partagé) rend caduc tout minuteur de frappe encore en attente :
    // sans cette annulation, il écrirait 300 ms plus tard la valeur en cours
    // de saisie au moment du changement externe, effaçant ce que celui-ci
    // vient justement de poser.
    clearTimeout(timerRef.current);
    lastEmittedRef.current = q;
    setDraft(q);
  }, [q]);

  // Le minuteur en cours est annulé au démontage : sans cela, une navigation
  // pendant les 300 ms écrirait dans l'URL d'un écran déjà quitté.
  useEffect(() => () => clearTimeout(timerRef.current), []);

  function handleSearchChange(value: string): void {
    setDraft(value);
    clearTimeout(timerRef.current);
    timerRef.current = setTimeout(() => {
      lastEmittedRef.current = value;
      onQueryChange(value);
    }, SEARCH_DEBOUNCE_MS);
  }

  function countFor(value: ApplicationTab): number | undefined {
    if (!stats.data) return undefined;
    const status = applicationTabToStatus(value);
    return status === null ? stats.data.total : stats.data.byStatus[status];
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <Tabs value={tab} onValueChange={(next) => onTabChange(next as ApplicationTab)} className="max-w-full">
          <TabsList className="flex-wrap">
            {APPLICATION_TAB_VALUES.map((value) => {
              const count = countFor(value);
              return (
                <TabsTrigger key={value} value={value}>
                  {APPLICATION_TAB_LABELS[value]}
                  {count === undefined ? (
                    <Skeleton data-slot="tab-count-skeleton" className="size-2 rounded-full" aria-hidden="true" />
                  ) : (
                    <span className="text-muted-foreground text-xs tabular-nums">{count}</span>
                  )}
                </TabsTrigger>
              );
            })}
          </TabsList>
        </Tabs>

        <AddApplicationButton onClick={onAdd} className="sm:ml-auto" />
      </div>

      <div className="flex flex-wrap items-center gap-3">
        <div className="relative min-w-0 flex-1 sm:max-w-sm">
          <Search aria-hidden="true" className="text-muted-foreground pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2" />
          <Input
            type="search"
            value={draft}
            maxLength={120}
            onChange={(event) => handleSearchChange(event.target.value)}
            placeholder="Rechercher un poste ou une entreprise"
            aria-label="Rechercher un poste ou une entreprise"
            className="pl-9"
          />
        </div>

        {/* Sans effet visible en vue Kanban (l'ordre y vient des colonnes/positions),
            mais reste réglable : la vue peut changer sans perdre le tri choisi. */}
        <Select value={sort} onValueChange={(next) => onSortChange(next as ApplicationSort)}>
          <SelectTrigger aria-label="Trier par" className="w-auto min-w-40">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {APPLICATION_SORT_VALUES.map((value) => (
              <SelectItem key={value} value={value}>
                {APPLICATION_SORT_LABELS[value]}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>

        {/* Deux boutons `aria-pressed` plutôt qu'un `Tabs` : la vue n'est pas un
            filtre de contenu mais une présentation du même contenu. */}
        <div role="group" aria-label="Affichage" className="flex items-center gap-1">
          <Button
            type="button"
            variant={view === 'table' ? 'secondary' : 'ghost'}
            size="icon"
            aria-pressed={view === 'table'}
            aria-label="Vue table"
            onClick={() => onViewChange('table')}
          >
            <Rows3 aria-hidden="true" />
          </Button>
          <Button
            type="button"
            variant={view === 'kanban' ? 'secondary' : 'ghost'}
            size="icon"
            aria-pressed={view === 'kanban'}
            aria-label="Vue Kanban"
            onClick={() => onViewChange('kanban')}
          >
            <KanbanSquare aria-hidden="true" />
          </Button>
        </div>
      </div>
    </div>
  );
}
