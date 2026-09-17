import type { CSSProperties, Ref } from 'react';
import type { DraggableAttributes, DraggableSyntheticListeners } from '@dnd-kit/core';
import { useSortable } from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import type { ApplicationDto } from '@jobtrack/shared';
import { GripVertical } from 'lucide-react';
import { MatchBadge } from '@/features/matching/components/match-badge';
import { cn } from '@/lib/utils';
import { usePrefersReducedMotion } from '../hooks/use-prefers-reduced-motion';
import { formatApplicationDate, sourceLabel } from '../lib/format';
import { MoveToMenu } from './move-to-menu';

const CARD_CLASS = 'bg-card text-card-foreground relative rounded-lg border p-3 shadow-xs';

export interface DragHandleProps {
  ref?: Ref<HTMLButtonElement>;
  attributes?: DraggableAttributes;
  listeners?: DraggableSyntheticListeners;
}

/** Contenu visible d'une carte, identique dans la colonne et dans la superposition. */
function CardContent({ application }: { application: ApplicationDto }) {
  const match = application.job?.match ?? null;

  return (
    <>
      <span className="block text-sm font-semibold">{application.company ?? 'Entreprise non précisée'}</span>
      <span className="text-muted-foreground mt-0.5 block text-sm">{application.jobTitle}</span>
      <span className="mt-2 flex flex-wrap items-center gap-x-2 gap-y-1 text-xs">
        {application.salaryLabel !== null && (
          <span className="text-foreground/80 font-medium">{application.salaryLabel}</span>
        )}
        <span className="text-muted-foreground">{formatApplicationDate(application.appliedAt)}</span>
        <span className="text-muted-foreground">{sourceLabel(application)}</span>
        {match !== null && match.score !== null && <MatchBadge score={match.score} band={match.band} size="sm" />}
      </span>
    </>
  );
}

interface ApplicationCardProps {
  application: ApplicationDto;
  onOpen: (id: string) => void;
  /**
   * Écouteurs de saisie posés sur la seule poignée (spec §2) : le corps de la
   * carte reste un bouton d'ouverture cliquable.
   */
  dragHandleProps?: DragHandleProps;
  /**
   * Copie inerte affichée dans le `DragOverlay` pendant un déplacement : ni
   * bouton d'ouverture, ni poignée, ni menu « Déplacer vers… ». Sans cela, la
   * carte saisie existerait deux fois dans le DOM avec les mêmes commandes,
   * dont un second menu atteignable au clavier, et son texte serait annoncé
   * en double par-dessus les annonces de déplacement.
   */
  presentational?: boolean;
}

export function ApplicationCard({
  application,
  onOpen,
  dragHandleProps,
  presentational = false,
}: ApplicationCardProps) {
  if (presentational) {
    return (
      <div className={CARD_CLASS} aria-hidden="true">
        <CardContent application={application} />
      </div>
    );
  }

  return (
    <div className={CARD_CLASS}>
      <button
        type="button"
        onClick={() => onOpen(application.id)}
        aria-label={`Ouvrir la candidature ${application.jobTitle}`}
        className="focus-visible:ring-ring block w-full pr-16 text-left focus-visible:ring-2 focus-visible:outline-none"
      >
        <CardContent application={application} />
      </button>

      <div className="absolute top-2 right-2 flex items-center gap-0.5">
        <button
          type="button"
          ref={dragHandleProps?.ref}
          {...dragHandleProps?.attributes}
          {...dragHandleProps?.listeners}
          aria-label={`Déplacer ${application.jobTitle}`}
          className="text-muted-foreground hover:bg-accent hover:text-foreground focus-visible:ring-ring inline-flex size-7 cursor-grab touch-none items-center justify-center rounded-md focus-visible:ring-2 focus-visible:outline-none"
        >
          <GripVertical className="size-4" aria-hidden="true" />
        </button>
        <MoveToMenu application={application} />
      </div>
    </div>
  );
}

interface SortableApplicationCardProps {
  application: ApplicationDto;
  onOpen: (id: string) => void;
}

/**
 * Carte inscrite dans la `SortableContext` de sa colonne (`board-column.tsx`).
 * Séparée de `ApplicationCard` parce que le `DragOverlay` rend la même carte
 * pour le même identifiant : deux `useSortable` concurrents se
 * surchargeraient dans le registre des nœuds déplaçables de `@dnd-kit`.
 */
export function SortableApplicationCard({ application, onOpen }: SortableApplicationCardProps) {
  const reducedMotion = usePrefersReducedMotion();
  const { attributes, listeners, setNodeRef, setActivatorNodeRef, transform, transition, isDragging } = useSortable({
    id: application.id,
    // Sans cela, `@dnd-kit` pose un `aria-roledescription="sortable"` en
    // anglais au milieu d'une interface entièrement française.
    attributes: { roleDescription: 'candidature déplaçable' },
  });

  const style: CSSProperties = {
    transform: CSS.Transform.toString(transform),
    transition: reducedMotion ? undefined : transition,
  };

  return (
    <li ref={setNodeRef} style={style} className={cn('list-none', isDragging && 'opacity-40')}>
      <ApplicationCard
        application={application}
        onOpen={onOpen}
        dragHandleProps={{ ref: setActivatorNodeRef, attributes, listeners }}
      />
    </li>
  );
}
