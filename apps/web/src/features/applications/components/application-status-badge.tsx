import type { ApplicationStatus } from '@jobtrack/shared';
import { APPLICATION_STATUS_LABELS } from '@jobtrack/shared';
import { Badge } from '@/components/ui/badge';
import { cn } from '@/lib/utils';

/**
 * Une couleur retenue par statut (spec §2/§7), toutes exprimées avec les
 * jetons de thème (`--primary`, `--warning`, `--success`, `--destructive`,
 * `--muted`) : le mode sombre les redéfinit lui-même dans
 * `styles/tokens.css`, aucune variante `dark:` à maintenir ici. Fond en
 * teinte très diluée et texte en teinte pleine : lisible sur les deux
 * thèmes sans jamais virer au bloc de couleur saturé.
 */
const STATUS_CLASSES: Record<ApplicationStatus, string> = {
  TO_APPLY: 'bg-muted text-muted-foreground',
  APPLIED: 'bg-primary/10 text-primary',
  INTERVIEW: 'bg-warning/15 text-warning',
  OFFER: 'bg-success/15 text-success',
  REJECTED: 'bg-destructive/10 text-destructive',
};

interface ApplicationStatusBadgeProps {
  status: ApplicationStatus;
  className?: string;
}

/** Pastille de statut d'une candidature (spec §2 : table, Kanban, panneau de détail). */
export function ApplicationStatusBadge({ status, className }: ApplicationStatusBadgeProps) {
  return (
    <Badge variant="secondary" data-status={status} className={cn(STATUS_CLASSES[status], className)}>
      {APPLICATION_STATUS_LABELS[status]}
    </Badge>
  );
}
