import { Plus } from 'lucide-react';
import { Button } from '@/components/ui/button';

export interface TagSuggestionsProps {
  /** Nom accessible du groupe (« Suggestions de postes »…). */
  label: string;
  suggestions: readonly string[];
  onPick: (value: string) => void;
}

/**
 * Pastilles cliquables sous un champ « tags » (liste séparée par des virgules). Des boutons
 * plutôt qu'une liste déroulante : toujours visibles, atteignables au clavier par Tab, et
 * sans piège de focus sur mobile. Rien n'est rendu quand il n'y a rien à proposer.
 */
export function TagSuggestions({ label, suggestions, onPick }: TagSuggestionsProps) {
  if (suggestions.length === 0) return null;
  return (
    <div role="group" aria-label={label} className="flex flex-wrap gap-1.5">
      {suggestions.map((suggestion) => (
        <Button
          key={suggestion}
          type="button"
          variant="outline"
          size="xs"
          className="rounded-full"
          onClick={() => onPick(suggestion)}
        >
          <Plus aria-hidden="true" />
          {suggestion}
        </Button>
      ))}
    </div>
  );
}
