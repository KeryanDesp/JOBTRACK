import type { ApplicationEventDto, ApplicationEventType } from '@jobtrack/shared';
import { APPLICATION_EVENT_LABELS, APPLICATION_STATUS_LABELS } from '@jobtrack/shared';
import type { LucideIcon } from 'lucide-react';
import { ArrowRight, FileText, PenLine, Plus } from 'lucide-react';
import { formatRelativeTime } from '@/features/jobs/lib/format';

const EVENT_ICONS: Record<ApplicationEventType, LucideIcon> = {
  CREATED: Plus,
  STATUS_CHANGED: ArrowRight,
  NOTE_UPDATED: PenLine,
  RESUME_CHANGED: FileText,
};

/**
 * Un changement de statut dit ce qu'il change (« Entretien → Offre ») plutôt
 * que le générique « Statut modifié » ; les deux bornes sont nécessaires, un
 * évènement incomplet retombe sur le libellé de son type.
 */
function eventLabel(event: ApplicationEventDto): string {
  if (event.type === 'STATUS_CHANGED' && event.fromStatus !== null && event.toStatus !== null) {
    return `${APPLICATION_STATUS_LABELS[event.fromStatus]} → ${APPLICATION_STATUS_LABELS[event.toStatus]}`;
  }
  return APPLICATION_EVENT_LABELS[event.type];
}

interface ApplicationEventsProps {
  events: ApplicationEventDto[];
}

/** Historique antéchronologique (spec §2, point 5). */
export function ApplicationEvents({ events }: ApplicationEventsProps) {
  if (events.length === 0) {
    return <p className="text-muted-foreground text-sm">Aucun évènement.</p>;
  }

  // Le serveur renvoie déjà l'ordre antéchronologique ; ce tri le garantit
  // aussi pour un appelant qui recomposerait la liste (mise à jour optimiste).
  // `createdAt` est une chaîne ISO : l'ordre lexicographique est l'ordre
  // chronologique, aucune conversion en `Date` nécessaire.
  const ordered = [...events].sort((a, b) => b.createdAt.localeCompare(a.createdAt));

  return (
    <ol className="space-y-3">
      {ordered.map((event) => {
        const Icon = EVENT_ICONS[event.type];
        return (
          <li key={event.id} className="flex items-start gap-3">
            <span className="bg-muted mt-0.5 flex size-6 shrink-0 items-center justify-center rounded-full">
              <Icon className="text-muted-foreground size-3.5" aria-hidden="true" />
            </span>
            <span className="min-w-0 flex-1">
              <span className="block text-sm">{eventLabel(event)}</span>
              <span className="text-muted-foreground block text-xs">{formatRelativeTime(event.createdAt)}</span>
            </span>
          </li>
        );
      })}
    </ol>
  );
}
