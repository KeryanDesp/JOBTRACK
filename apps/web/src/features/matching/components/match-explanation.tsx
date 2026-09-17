import { AlertTriangle, Check } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible';

interface MatchExplanationProps {
  explanation: { top: string[]; weak: string[] };
  className?: string;
}

/**
 * Explication dépliable sur une carte (spec §2) : déclencheur « Pourquoi ? »,
 * lignes ✓ (`top`, jusqu'à 3, meilleurs facteurs) et ⚠ (`weak`, jusqu'à 2,
 * facteur le plus pénalisant). Toutes les lignes viennent du moteur de score
 * (`MatchScoreSummaryDto.explanation`) — jamais composées ici. Non contrôlé :
 * `CollapsiblePrimitive` gère seul `aria-expanded`/`data-state` sur le
 * déclencheur à partir de son propre état ouvert/fermé.
 */
export function MatchExplanation({ explanation, className }: MatchExplanationProps) {
  if (explanation.top.length === 0 && explanation.weak.length === 0) return null;

  return (
    <Collapsible className={className}>
      <CollapsibleTrigger asChild>
        <Button
          type="button"
          variant="ghost"
          size="sm"
          className="h-auto px-0 text-muted-foreground hover:bg-transparent hover:text-foreground"
        >
          Pourquoi ?
        </Button>
      </CollapsibleTrigger>
      <CollapsibleContent className="mt-2 space-y-2 text-sm">
        {explanation.top.length > 0 && (
          <div className="space-y-1">
            {explanation.top.map((line, index) => (
              <p key={`top-${index}`} className="flex items-start gap-1.5">
                <Check className="mt-0.5 size-3.5 shrink-0 text-success" aria-hidden="true" />
                <span>{line}</span>
              </p>
            ))}
          </div>
        )}
        {explanation.weak.length > 0 && (
          <div className="space-y-1">
            {explanation.weak.map((line, index) => (
              <p key={`weak-${index}`} className="flex items-start gap-1.5">
                <AlertTriangle className="mt-0.5 size-3.5 shrink-0 text-warning" aria-hidden="true" />
                <span>{line}</span>
              </p>
            ))}
          </div>
        )}
      </CollapsibleContent>
    </Collapsible>
  );
}
