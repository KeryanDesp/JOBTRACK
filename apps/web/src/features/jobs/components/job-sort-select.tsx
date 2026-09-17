import type { JobSort } from '@jobtrack/shared';
import { JOB_SORT_OPTIONS } from '@jobtrack/shared';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';

interface JobSortSelectProps {
  value: JobSort;
  onChange: (value: JobSort) => void;
}

/**
 * Les quatre tris (spec §2/§7) sont désormais tous actifs : « Meilleur match »
 * (score décroissant, non évaluées en dernier) et « Pertinence » (score
 * pondéré par la fraîcheur, §5) s'appuient sur le score de correspondance
 * calculé côté serveur (tranche 4).
 */
export function JobSortSelect({ value, onChange }: JobSortSelectProps) {
  return (
    <Select value={value} onValueChange={(next) => onChange(next as JobSort)}>
      <SelectTrigger aria-label="Trier par" className="w-[210px]">
        <SelectValue />
      </SelectTrigger>
      <SelectContent>
        {JOB_SORT_OPTIONS.map((option) => (
          <SelectItem key={option.value} value={option.value}>
            {option.label}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}
