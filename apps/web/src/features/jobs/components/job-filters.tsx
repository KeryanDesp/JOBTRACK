import type { ContractType, ExperienceLevel, JobSearchQuery, RemoteMode } from '@jobtrack/shared';
import {
  CONTRACT_TYPE_LABELS,
  EXPERIENCE_LEVEL_LABELS,
  JOB_SOURCE_KINDS,
  JOB_SOURCE_LABELS,
  PUBLISHED_WITHIN_OPTIONS,
  REMOTE_MODE_LABELS,
} from '@jobtrack/shared';
import { SlidersHorizontal } from 'lucide-react';
import { useState } from 'react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Sheet, SheetContent, SheetFooter, SheetHeader, SheetTitle, SheetTrigger } from '@/components/ui/sheet';

type FilterValues = Pick<
  JobSearchQuery,
  'contractTypes' | 'remoteModes' | 'experienceLevels' | 'salaryMin' | 'publishedWithinDays' | 'sources'
>;

interface JobFiltersProps {
  value: FilterValues;
  onChange: (patch: Partial<FilterValues>) => void;
}

// Une seule source existe pour l'instant (France Travail, spec §1/§10) : le filtre ne
// s'affichera qu'à partir d'un deuxième connecteur (tranche 8), sans qu'il faille toucher
// à ce composant — `JOB_SOURCE_KINDS` vient du contrat partagé.
const SOURCE_OPTIONS = JOB_SOURCE_KINDS.map((kind) => ({ value: kind, label: JOB_SOURCE_LABELS[kind] }));

const PUBLISHED_ANY = 'any';

function countActiveFilters(value: FilterValues): number {
  let count = value.contractTypes.length + value.remoteModes.length + value.experienceLevels.length + value.sources.length;
  if (value.salaryMin !== undefined) count += 1;
  if (value.publishedWithinDays !== undefined) count += 1;
  return count;
}

function emptyFilters(): FilterValues {
  return { contractTypes: [], remoteModes: [], experienceLevels: [], salaryMin: undefined, publishedWithinDays: undefined, sources: [] };
}

interface MultiSelectPopoverProps<T extends string> {
  label: string;
  options: { value: T; label: string }[];
  selected: readonly T[];
  onToggle: (next: T[]) => void;
}

function MultiSelectPopover<T extends string>({ label, options, selected, onToggle }: MultiSelectPopoverProps<T>) {
  function toggle(optionValue: T) {
    const next = selected.includes(optionValue) ? selected.filter((entry) => entry !== optionValue) : [...selected, optionValue];
    onToggle(next);
  }

  return (
    <Popover>
      <PopoverTrigger asChild>
        <Button type="button" variant="outline" size="sm">
          {label}
          {selected.length > 0 && <Badge variant="secondary">{selected.length}</Badge>}
        </Button>
      </PopoverTrigger>
      <PopoverContent align="start" className="w-56 p-2">
        <div className="space-y-1">
          {options.map((option) => (
            <label key={option.value} className="flex items-center gap-2 rounded-sm px-1 py-1.5 text-sm">
              <Checkbox checked={selected.includes(option.value)} onCheckedChange={() => toggle(option.value)} />
              {option.label}
            </label>
          ))}
        </div>
      </PopoverContent>
    </Popover>
  );
}

interface FilterFieldsProps {
  value: FilterValues;
  onFieldChange: (patch: Partial<FilterValues>) => void;
}

/** Champs partagés entre la rangée desktop et le `Sheet` mobile (spec §7). */
function FilterFields({ value, onFieldChange }: FilterFieldsProps) {
  return (
    <>
      <MultiSelectPopover<ContractType>
        label="Contrat"
        options={Object.entries(CONTRACT_TYPE_LABELS).map(([optionValue, label]) => ({ value: optionValue as ContractType, label }))}
        selected={value.contractTypes}
        onToggle={(next) => onFieldChange({ contractTypes: next })}
      />
      <MultiSelectPopover<RemoteMode>
        label="Télétravail"
        options={Object.entries(REMOTE_MODE_LABELS).map(([optionValue, label]) => ({ value: optionValue as RemoteMode, label }))}
        selected={value.remoteModes}
        onToggle={(next) => onFieldChange({ remoteModes: next })}
      />
      <MultiSelectPopover<ExperienceLevel>
        label="Expérience"
        options={Object.entries(EXPERIENCE_LEVEL_LABELS).map(([optionValue, label]) => ({
          value: optionValue as ExperienceLevel,
          label,
        }))}
        selected={value.experienceLevels}
        onToggle={(next) => onFieldChange({ experienceLevels: next })}
      />

      <div className="flex items-center gap-2">
        <Label htmlFor="job-filter-salary-min" className="sr-only">
          Salaire annuel minimum
        </Label>
        <Input
          id="job-filter-salary-min"
          type="number"
          step={1000}
          min={0}
          placeholder="Salaire annuel minimum"
          value={value.salaryMin ?? ''}
          onChange={(event) => {
            const raw = event.target.value;
            onFieldChange({ salaryMin: raw === '' ? undefined : Number(raw) });
          }}
          className="w-48"
        />
      </div>

      <Select
        value={value.publishedWithinDays === undefined ? PUBLISHED_ANY : String(value.publishedWithinDays)}
        onValueChange={(next) =>
          onFieldChange({
            publishedWithinDays: next === PUBLISHED_ANY ? undefined : (Number(next) as JobSearchQuery['publishedWithinDays']),
          })
        }
      >
        <SelectTrigger aria-label="Publication">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value={PUBLISHED_ANY}>Toute date</SelectItem>
          {PUBLISHED_WITHIN_OPTIONS.map((option) => (
            <SelectItem key={option.value} value={String(option.value)}>
              {option.label}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>

      {SOURCE_OPTIONS.length > 1 && (
        <MultiSelectPopover label="Source" options={SOURCE_OPTIONS} selected={value.sources} onToggle={(next) => onFieldChange({ sources: next })} />
      )}
    </>
  );
}

/**
 * Filtres (spec §2/§7) : rangée desktop appliquant chaque changement
 * immédiatement, `Sheet` mobile qui les regroupe derrière « Appliquer ».
 */
export function JobFilters({ value, onChange }: JobFiltersProps) {
  const [pending, setPending] = useState<FilterValues>(value);
  const [sheetOpen, setSheetOpen] = useState(false);
  const activeCount = countActiveFilters(value);

  function resetAll() {
    onChange(emptyFilters());
  }

  function openSheet(nextOpen: boolean) {
    if (nextOpen) setPending(value);
    setSheetOpen(nextOpen);
  }

  function applyPending() {
    onChange(pending);
    setSheetOpen(false);
  }

  return (
    <div>
      <div className="hidden flex-wrap items-center gap-2 md:flex">
        <FilterFields value={value} onFieldChange={onChange} />
        {activeCount > 0 && (
          <Button type="button" variant="ghost" size="sm" onClick={resetAll}>
            Réinitialiser
          </Button>
        )}
      </div>

      <div className="md:hidden">
        <Sheet open={sheetOpen} onOpenChange={openSheet}>
          <SheetTrigger asChild>
            <Button type="button" variant="outline" size="sm">
              <SlidersHorizontal />
              Filtres{activeCount > 0 ? ` (${activeCount})` : ''}
            </Button>
          </SheetTrigger>
          <SheetContent side="bottom">
            <SheetHeader>
              <SheetTitle>Filtres</SheetTitle>
            </SheetHeader>
            <div className="flex flex-col gap-3 overflow-auto px-4">
              <FilterFields value={pending} onFieldChange={(patch) => setPending((current) => ({ ...current, ...patch }))} />
            </div>
            <SheetFooter>
              <Button type="button" onClick={applyPending}>
                Appliquer
              </Button>
              {activeCount > 0 && (
                <Button
                  type="button"
                  variant="ghost"
                  onClick={() => {
                    resetAll();
                    setSheetOpen(false);
                  }}
                >
                  Réinitialiser
                </Button>
              )}
            </SheetFooter>
          </SheetContent>
        </Sheet>
      </div>
    </div>
  );
}
