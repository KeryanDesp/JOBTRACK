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
              <span tabIndex={0} className="inline-flex cursor-not-allowed">
                <TabsTrigger value={tab.value} disabled>
                  {tab.label}
                </TabsTrigger>
              </span>
            </TooltipTrigger>
            <TooltipContent>Disponible avec le score (tranche 4)</TooltipContent>
          </Tooltip>
        ))}
      </TabsList>
    </Tabs>
  );
}
