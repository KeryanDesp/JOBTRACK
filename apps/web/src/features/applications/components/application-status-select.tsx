import type { ApplicationStatus } from '@jobtrack/shared';
import { APPLICATION_STATUS_LABELS, APPLICATION_STATUSES } from '@jobtrack/shared';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { cn } from '@/lib/utils';

interface ApplicationStatusSelectProps {
  /** Posé sur le déclencheur : cible d'un `<Label htmlFor>` quand le sélecteur est dans un formulaire. */
  id?: string;
  value: ApplicationStatus;
  onChange: (value: ApplicationStatus) => void;
  /** `sm` pour l'usage inline dans la table ; `default` pour un formulaire. */
  size?: 'sm' | 'default';
  disabled?: boolean;
  /**
   * Obligatoire : plusieurs sélecteurs coexistent dans une même table, un
   * simple « Statut » ne permettrait pas de savoir lequel (spec §7 : « Statut
   * de <poste> »).
   */
  ariaLabel: string;
  className?: string;
}

/**
 * Sélecteur de statut (spec §2/§6), utilisé inline dans la table, dans le
 * formulaire de création et dans le panneau de détail. `APPLICATION_STATUSES`
 * fixe l'ordre (celui des colonnes du Kanban) ; aucune transition n'est
 * interdite — l'utilisateur doit pouvoir corriger une erreur de saisie.
 */
export function ApplicationStatusSelect({
  id,
  value,
  onChange,
  size = 'default',
  disabled = false,
  ariaLabel,
  className,
}: ApplicationStatusSelectProps) {
  return (
    <Select value={value} onValueChange={(next) => onChange(next as ApplicationStatus)} disabled={disabled}>
      <SelectTrigger id={id} size={size} aria-label={ariaLabel} className={cn('w-full min-w-[11rem]', className)}>
        <SelectValue />
      </SelectTrigger>
      <SelectContent>
        {APPLICATION_STATUSES.map((status) => (
          <SelectItem key={status} value={status}>
            {APPLICATION_STATUS_LABELS[status]}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}
