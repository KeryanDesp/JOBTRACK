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
 */
const DISABLED_TABS = [
  { value: 'for_you', label: 'Pour vous' },
  { value: 'priority', label: 'Forte priorité' },
] as const;

const DISABLED_HINT = 'Disponible avec le score (tranche 4)';

/**
 * Neutralise un événement qui activerait normalement l'onglet Radix : le
 * changement d'onglet est déclenché en interne dès `onMouseDown`/`onKeyDown`
 * (Entrée/Espace) et même `onFocus` (mode d'activation automatique — une
 * simple navigation au clavier vers cet onglet le sélectionnerait sinon).
 * `TabsTrigger` compose son propre gestionnaire après celui-ci
 * (`composeEventHandlers`) et l'ignore dès que `preventDefault()` est appelé
 * ici, quel que soit le type d'événement.
 */
function preventActivation(event: { preventDefault: () => void }): void {
  event.preventDefault();
}

/**
 * `TabsTrigger` reste focusable (pas de prop `disabled`, qui le retirerait de
 * l'ordre de tabulation et empêcherait l'info-bulle de recevoir le focus) :
 * `aria-disabled` porte l'état, et les gestionnaires ci-dessus neutralisent
 * toute activation (clic, clavier, focus automatique). Le déclencheur de
 * l'info-bulle est directement cet élément — plus de `<span>` englobant, qui
 * aurait rendu un rôle interactif (`button`) imbriqué dans un autre (`tab`).
 */
export function JobTabs({ value, onChange }: JobTabsProps) {
  return (
    <Tabs value={value} onValueChange={(next) => onChange(next as JobTab)}>
      <TabsList>
        {JOB_TABS.filter((tab) => !DISABLED_TABS.some((d) => d.value === tab.value)).map((tab) => (
          <TabsTrigger key={tab.value} value={tab.value}>
            {tab.label}
          </TabsTrigger>
        ))}
        {DISABLED_TABS.map((tab) => (
          <Tooltip key={tab.value}>
            <TooltipTrigger asChild>
              <TabsTrigger
                value={tab.value}
                aria-disabled="true"
                aria-label={`${tab.label} : ${DISABLED_HINT}`}
                className="cursor-not-allowed opacity-50"
                onMouseDown={preventActivation}
                onClick={preventActivation}
                onKeyDown={preventActivation}
                onFocus={preventActivation}
              >
                {tab.label}
              </TabsTrigger>
            </TooltipTrigger>
            <TooltipContent>{DISABLED_HINT}</TooltipContent>
          </Tooltip>
        ))}
      </TabsList>
    </Tabs>
  );
}
