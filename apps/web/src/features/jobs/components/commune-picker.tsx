import type { CommuneDto } from '@jobtrack/shared';
import { X } from 'lucide-react';
import { useId, useRef, useState, type KeyboardEvent } from 'react';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { Popover, PopoverAnchor, PopoverContent } from '@/components/ui/popover';
import { cn } from '@/lib/utils';
import { useCommuneSearch } from '../hooks/use-jobs';

interface CommunePickerProps {
  value: CommuneDto[];
  onChange: (next: CommuneDto[]) => void;
}

const MAX_COMMUNES = 3;

/**
 * Combobox de communes (spec §7) : `Popover` + `Input` + listbox maison,
 * autocomplétion via `useCommuneSearch` (anti-rebond 250 ms côté hook).
 * Puces retirables jusqu'à trois lieux ; au-delà, la saisie est désactivée
 * plutôt que d'accepter une quatrième sélection silencieusement ignorée.
 */
export function CommunePicker({ value, onChange }: CommunePickerProps) {
  const [inputValue, setInputValue] = useState('');
  const [focused, setFocused] = useState(false);
  const [activeIndex, setActiveIndex] = useState(-1);
  const listboxId = useId();
  const inputRef = useRef<HTMLInputElement>(null);

  const atMax = value.length >= MAX_COMMUNES;
  const trimmed = inputValue.trim();
  // Sous le max autorisé de caractères, aucune requête n'est déclenchée (le hook l'exige déjà),
  // mais on force aussi une chaîne vide une fois le maximum de communes atteint : la saisie est
  // désactivée, inutile de laisser une recherche déjà en vol rouvrir la liste.
  const searchQuery = useCommuneSearch(atMax ? '' : inputValue);
  const options = searchQuery.data ?? [];
  const open = focused && !atMax && trimmed.length >= 2;

  function selectCommune(commune: CommuneDto) {
    if (value.some((entry) => entry.code === commune.code)) return;
    onChange([...value, commune]);
    setInputValue('');
    setActiveIndex(-1);
    inputRef.current?.focus();
  }

  function removeCommune(code: string) {
    onChange(value.filter((entry) => entry.code !== code));
  }

  function handleKeyDown(event: KeyboardEvent<HTMLInputElement>) {
    if (event.key === 'Escape') {
      setFocused(false);
      setActiveIndex(-1);
      return;
    }
    if (!open || options.length === 0) return;

    if (event.key === 'ArrowDown') {
      event.preventDefault();
      setActiveIndex((index) => Math.min(index + 1, options.length - 1));
    } else if (event.key === 'ArrowUp') {
      event.preventDefault();
      setActiveIndex((index) => Math.max(index - 1, 0));
    } else if (event.key === 'Enter' && activeIndex >= 0) {
      const commune = options[activeIndex];
      if (commune) {
        event.preventDefault();
        selectCommune(commune);
      }
    }
  }

  return (
    <div className="space-y-2">
      <Popover open={open} onOpenChange={(next) => setFocused(next)}>
        <PopoverAnchor asChild>
          <Input
            ref={inputRef}
            role="combobox"
            aria-expanded={open}
            aria-controls={listboxId}
            aria-autocomplete="list"
            autoComplete="off"
            placeholder={atMax ? 'Trois lieux maximum.' : 'Ville, code postal…'}
            value={inputValue}
            disabled={atMax}
            onChange={(event) => {
              setInputValue(event.target.value);
              setActiveIndex(-1);
              setFocused(true);
            }}
            onFocus={() => setFocused(true)}
            onKeyDown={handleKeyDown}
          />
        </PopoverAnchor>
        <PopoverContent
          align="start"
          className="w-(--radix-popover-trigger-width) p-1"
          onOpenAutoFocus={(event) => event.preventDefault()}
        >
          <ul id={listboxId} role="listbox" className="max-h-56 space-y-0.5 overflow-auto">
            {searchQuery.isFetching && <li className="px-2 py-1.5 text-sm text-muted-foreground">Recherche…</li>}
            {!searchQuery.isFetching && options.length === 0 && (
              <li className="px-2 py-1.5 text-sm text-muted-foreground">Aucune commune trouvée.</li>
            )}
            {options.map((commune, index) => (
              <li
                key={commune.code}
                role="option"
                aria-selected={index === activeIndex}
                className={cn(
                  'cursor-pointer rounded-sm px-2 py-1.5 text-sm',
                  index === activeIndex && 'bg-accent text-accent-foreground',
                )}
                onMouseEnter={() => setActiveIndex(index)}
                onMouseDown={(event) => {
                  event.preventDefault();
                  selectCommune(commune);
                }}
              >
                {commune.name}
                {commune.postalCode ? ` (${commune.postalCode})` : ''}
              </li>
            ))}
          </ul>
        </PopoverContent>
      </Popover>

      {atMax && <p className="text-sm text-muted-foreground">Trois lieux maximum.</p>}

      {value.length > 0 && (
        <div className="flex flex-wrap gap-1.5">
          {value.map((commune) => (
            <Badge key={commune.code} variant="secondary" className="gap-1 pr-1">
              {commune.name}
              <button
                type="button"
                aria-label={`Retirer ${commune.name}`}
                onClick={() => removeCommune(commune.code)}
                className="rounded-full p-0.5 hover:bg-background/50"
              >
                <X className="size-3" />
              </button>
            </Badge>
          ))}
        </div>
      )}
    </div>
  );
}
