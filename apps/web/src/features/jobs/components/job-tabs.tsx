import type { JobTab } from '@jobtrack/shared';
import { JOB_TABS } from '@jobtrack/shared';
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs';

interface JobTabsProps {
  value: JobTab;
  onChange: (value: JobTab) => void;
}

/**
 * Les quatre onglets (spec §2/§7) sont désormais tous actifs : « Pour vous »
 * (score ≥ 60) et « Forte priorité » (priorité ≥ Forte) s'appuient sur le
 * score de correspondance calculé côté serveur (tranche 4). Un onglet sans
 * offre évaluée n'est pas un état d'erreur — voir l'état vide dédié de
 * `JobList` — jamais une donnée simulée ici.
 */
export function JobTabs({ value, onChange }: JobTabsProps) {
  return (
    <Tabs value={value} onValueChange={(next) => onChange(next as JobTab)}>
      <TabsList>
        {JOB_TABS.map((tab) => (
          <TabsTrigger key={tab.value} value={tab.value}>
            {tab.label}
          </TabsTrigger>
        ))}
      </TabsList>
    </Tabs>
  );
}
