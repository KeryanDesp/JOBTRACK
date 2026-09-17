import type { MatchPriority } from '@jobtrack/shared';
import { PRIORITY_LABELS } from '@jobtrack/shared';
import { Badge } from '@/components/ui/badge';
import { cn } from '@/lib/utils';

interface PriorityChipProps {
  priority: MatchPriority | null;
  className?: string;
}

// Teintes sémantiques (jetons `tokens.css`) : `VERY_HIGH`/`HIGH` → primaire
// (violet, priorité forte), `GOOD` → succès en contour, `CONSIDER` → neutre,
// `LOW` → atténué. Jamais de rouge/orange ici : une faible correspondance
// n'est pas une erreur (cahier des charges : ton jamais anxiogène).
const PRIORITY_TONE_CLASSES: Record<MatchPriority, string> = {
  VERY_HIGH: 'border-transparent bg-primary text-primary-foreground',
  HIGH: 'border-transparent bg-primary text-primary-foreground',
  GOOD: 'border-success/40 bg-success/10 text-success',
  CONSIDER: 'border-border bg-secondary text-secondary-foreground',
  LOW: 'border-transparent bg-muted text-muted-foreground',
};

/** Puce de priorité (spec §2/§7) : rien n'est rendu sans priorité connue (`null`). */
export function PriorityChip({ priority, className }: PriorityChipProps) {
  if (priority === null) return null;

  return (
    <Badge variant="outline" className={cn(PRIORITY_TONE_CLASSES[priority], className)}>
      {PRIORITY_LABELS[priority]}
    </Badge>
  );
}
