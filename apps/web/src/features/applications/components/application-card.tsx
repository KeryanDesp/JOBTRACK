import type { CSSProperties, Ref } from 'react';
import { useEffect, useState } from 'react';
import type { DraggableAttributes, DraggableSyntheticListeners } from '@dnd-kit/core';
import { useSortable } from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import type { ApplicationDto } from '@jobtrack/shared';
import { APPLICATION_SOURCE_LABELS } from '@jobtrack/shared';
import { GripVertical } from 'lucide-react';
import { MatchBadge } from '@/features/matching/components/match-badge';
import { cn } from '@/lib/utils';
import { MoveToMenu } from './move-to-menu';

// `timeZone: 'UTC'` : `appliedAt` est une date calendaire (AAAA-MM-JJ, colonne
// `@db.Date`) que `new Date()` interprète à minuit UTC — sans ce fuseau, un
// client à l'ouest de Greenwich afficherait la veille.
const APPLIED_AT_FORMAT = new Intl.DateTimeFormat('fr-FR', {
  timeZone: 'UTC',
  day: '2-digit',
  month: '2-digit',
  year: 'numeric',
});

/**
 * Provisoire (tâche 6, phase 1) : `formatApplicationDate` de
 * `../lib/format.ts` est écrit en parallèle par une autre tâche et n'est pas
 * encore importable. Ce helper local sera remplacé par le partagé en phase 2.
 */
function formatAppliedAt(value: string | null): string {
  if (value === null || value === '') return '—';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '—';
  return APPLIED_AT_FORMAT.format(date);
}

const REDUCED_MOTION_QUERY = '(prefers-reduced-motion: reduce)';

/**
 * `prefers-reduced-motion` (spec §7) sans dépendre de Framer Motion : la
 * valeur sert à retirer complètement la transition de réordonnancement de
 * `@dnd-kit` (une propriété CSS `transition` inline, que la règle globale de
 * `tokens.css` ne peut pas neutraliser). `matchMedia` est absent de jsdom :
 * l'absence de l'API vaut « pas de préférence » plutôt qu'une exception.
 */
export function usePrefersReducedMotion(): boolean {
  const [reduced, setReduced] = useState(false);

  useEffect(() => {
    if (typeof window.matchMedia !== 'function') return;
    const query = window.matchMedia(REDUCED_MOTION_QUERY);
    setReduced(query.matches);
    const handleChange = (event: MediaQueryListEvent) => setReduced(event.matches);
    query.addEventListener('change', handleChange);
    return () => query.removeEventListener('change', handleChange);
  }, []);

  return reduced;
}

export interface DragHandleProps {
  ref?: Ref<HTMLButtonElement>;
  attributes?: DraggableAttributes;
  listeners?: DraggableSyntheticListeners;
}

interface ApplicationCardProps {
  application: ApplicationDto;
  onOpen: (id: string) => void;
  /**
   * Écouteurs de saisie posés sur la seule poignée (spec §2) : le corps de la
   * carte reste un bouton d'ouverture cliquable. Absent quand la carte est
   * rendue dans le `DragOverlay`, qui ne doit enregistrer aucun nœud
   * déplaçable supplémentaire pour le même identifiant.
   */
  dragHandleProps?: DragHandleProps;
}

export function ApplicationCard({ application, onOpen, dragHandleProps }: ApplicationCardProps) {
  const match = application.job?.match ?? null;

  return (
    <div className="bg-card text-card-foreground relative rounded-lg border p-3 shadow-xs">
      <button
        type="button"
        onClick={() => onOpen(application.id)}
        aria-label={`Ouvrir la candidature ${application.jobTitle}`}
        className="focus-visible:ring-ring block w-full pr-16 text-left focus-visible:ring-2 focus-visible:outline-none"
      >
        <span className="block text-sm font-semibold">{application.company ?? 'Entreprise non précisée'}</span>
        <span className="text-muted-foreground mt-0.5 block text-sm">{application.jobTitle}</span>
        <span className="mt-2 flex flex-wrap items-center gap-x-2 gap-y-1 text-xs">
          {application.salaryLabel !== null && (
            <span className="text-foreground/80 font-medium">{application.salaryLabel}</span>
          )}
          <span className="text-muted-foreground">{formatAppliedAt(application.appliedAt)}</span>
          <span className="text-muted-foreground">{APPLICATION_SOURCE_LABELS[application.source]}</span>
          {match !== null && match.score !== null && <MatchBadge score={match.score} band={match.band} size="sm" />}
        </span>
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
