import type { JobTab } from '@jobtrack/shared';
import { JOB_TABS } from '@jobtrack/shared';
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';

interface JobTabsProps {
  value: JobTab;
  onChange: (value: JobTab) => void;
}

/**
 * Deux onglets utilisables aujourd'hui (« Toutes »/« Nouvelles », spec §2) et
 * deux onglets à venir, visibles mais désactivés (score, tranche 4) : aucune
 * donnée simulée derrière eux, seulement l'info-bulle qui explique pourquoi.
 * `TabsTrigger` désactivé perd les événements pointeur (`disabled:pointer-events-none`
 * du composant `Tabs`) : le déclencheur de l'info-bulle est donc le `<span>`
 * englobant, qui reste seul à recevoir le survol.
 */
const DISABLED_TABS = [
  { value: 'for-you', label: 'Pour vous' },
  { value: 'high-priority', label: 'Forte priorité' },
] as const;

const DISABLED_HINT = 'Disponible avec le score (tranche 4)';

export function JobTabs({ value, onChange }: JobTabsProps) {
  return (
    <Tabs value={value} onValueChange={(next) => onChange(next as JobTab)}>
      <TabsList>
        {JOB_TABS.map((tab) => (
          <TabsTrigger key={tab.value} value={tab.value}>
            {tab.label}
          </TabsTrigger>
        ))}
        {DISABLED_TABS.map((tab) => (
          <Tooltip key={tab.value}>
            <TooltipTrigger asChild>
              {/*
                `role="button" aria-disabled` plutôt qu'un onglet réellement désactivé :
                un lecteur d'écran doit entendre pourquoi l'action est indisponible
                (`aria-label` porte l'info-bulle elle-même), pas seulement son libellé.
                `TabsTrigger disabled` reste seulement pour le rendu visuel (grisé,
                `pointer-events-none`) — le `<span>` englobant reçoit seul le survol/focus.
              */}
              <span role="button" aria-disabled="true" aria-label={DISABLED_HINT} tabIndex={0} className="inline-flex cursor-not-allowed">
                <TabsTrigger value={tab.value} disabled>
                  {tab.label}
                </TabsTrigger>
              </span>
            </TooltipTrigger>
            <TooltipContent>{DISABLED_HINT}</TooltipContent>
          </Tooltip>
        ))}
      </TabsList>
    </Tabs>
  );
}
