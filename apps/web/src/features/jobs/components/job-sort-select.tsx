import type { JobSort } from '@jobtrack/shared';
import { JOB_SORT_OPTIONS } from '@jobtrack/shared';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';

interface JobSortSelectProps {
  value: JobSort;
  onChange: (value: JobSort) => void;
}

/** Options futures désactivées (score, tranche 4), avec leur explication portée par l'option elle-même. */
const DISABLED_OPTIONS = [
  { value: 'relevance', label: 'Pertinence' },
  { value: 'match', label: 'Meilleur match' },
] as const;

export function JobSortSelect({ value, onChange }: JobSortSelectProps) {
  return (
    <Select value={value} onValueChange={(next) => onChange(next as JobSort)}>
      <SelectTrigger aria-label="Trier par" className="w-[210px]">
        <SelectValue />
      </SelectTrigger>
      <SelectContent>
        {JOB_SORT_OPTIONS.filter((option) => !DISABLED_OPTIONS.some((d) => d.value === option.value)).map((option) => (
          <SelectItem key={option.value} value={option.value}>
            {option.label}
          </SelectItem>
        ))}
        {DISABLED_OPTIONS.map((option) => (
          <SelectItem key={option.value} value={option.value} disabled>
            <span className="flex flex-col">
              <span>{option.label}</span>
              <span className="text-xs text-muted-foreground">Disponible avec le score (tranche 4)</span>
            </span>
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}
