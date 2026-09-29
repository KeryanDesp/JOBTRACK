import type { ApplicationStatsDto } from '@jobtrack/shared';
import { APPLICATION_STATUSES, APPLICATION_STATUS_LABELS } from '@jobtrack/shared';
import { cn } from '@/lib/utils';
import { STATUS_FILL_CLASSES } from '@/features/applications/lib/status';

interface PipelineBarProps {
  byStatus: ApplicationStatsDto['byStatus'];
  total: number;
}

/**
 * Répartition des candidatures par statut, en une barre empilée suivie de sa légende chiffrée.
 *
 * La barre elle-même est `aria-hidden` : une suite de segments proportionnels n'a aucun sens à
 * l'oral. La légende qui suit porte les mêmes chiffres en texte, donc rien n'est perdu — c'est
 * elle que lit un lecteur d'écran.
 *
 * Les statuts à zéro sont absents de la barre (un segment de largeur nulle n'a rien à y faire)
 * mais présents dans la légende : « 0 entretien » est une information, pas un vide.
 */
export function PipelineBar({ byStatus, total }: PipelineBarProps) {
  const present = APPLICATION_STATUSES.filter((status) => byStatus[status] > 0);

  return (
    <div>
      <div className="bg-muted flex h-2.5 w-full gap-0.5 overflow-hidden rounded-full" aria-hidden>
        {present.map((status) => (
          <div
            key={status}
            className={cn('h-full', STATUS_FILL_CLASSES[status])}
            style={{ width: `${(byStatus[status] / total) * 100}%` }}
          />
        ))}
      </div>

      <ul className="mt-4 grid grid-cols-2 gap-x-4 gap-y-2 sm:grid-cols-3 lg:grid-cols-5">
        {APPLICATION_STATUSES.map((status) => (
          <li key={status} className="flex items-baseline gap-2">
            <span className={cn('size-2 shrink-0 translate-y-[-1px] rounded-full', STATUS_FILL_CLASSES[status])} aria-hidden />
            <span className="min-w-0">
              <span className="text-sm font-medium tabular-nums">{byStatus[status]}</span>{' '}
              <span className="text-muted-foreground text-xs">{APPLICATION_STATUS_LABELS[status]}</span>
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}
