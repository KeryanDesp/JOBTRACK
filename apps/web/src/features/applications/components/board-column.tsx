import { useDroppable } from '@dnd-kit/core';
import { SortableContext, verticalListSortingStrategy } from '@dnd-kit/sortable';
import type { ApplicationDto, ApplicationStatus } from '@jobtrack/shared';
import { Badge } from '@/components/ui/badge';
import { cn } from '@/lib/utils';
import { SortableApplicationCard } from './application-card';
import { ApplicationStatusBadge } from './application-status-badge';

interface BoardColumnProps {
  status: ApplicationStatus;
  items: ApplicationDto[];
  onOpen: (id: string) => void;
  /**
   * Message affiché à la place de la liste vide. Seule la première colonne le
   * reçoit, et seulement quand le board entier est vide (spec §7) : répéter
   * « Aucune candidature » dans les cinq colonnes ne dirait rien de plus.
   */
  emptyHint?: string;
}

export function BoardColumn({ status, items, onOpen, emptyHint }: BoardColumnProps) {
  const { isOver, setNodeRef } = useDroppable({ id: status });
  const headingId = `colonne-${status}`;
  const countLabel = items.length > 1 ? `${items.length} candidatures` : `${items.length} candidature`;

  return (
    <section aria-labelledby={headingId} className="w-[280px] shrink-0 snap-start md:w-auto md:flex-1">
      <div className="flex items-center justify-between gap-2 px-1 pb-2">
        {/* La pastille porte le titre de la colonne : même couleur de statut que
            dans la table et le panneau de détail, sans perdre le niveau de titre
            qui structure la page pour un lecteur d'écran. */}
        <h3 id={headingId} className="text-sm font-semibold">
          <ApplicationStatusBadge status={status} />
        </h3>
        <Badge variant="secondary" aria-label={countLabel}>
          {items.length}
        </Badge>
      </div>

      <div
        ref={setNodeRef}
        className={cn(
          'bg-muted/40 min-h-40 rounded-lg p-2 transition-colors',
          isOver && 'bg-accent ring-ring/40 ring-2',
        )}
      >
        <SortableContext items={items.map((item) => item.id)} strategy={verticalListSortingStrategy}>
          <ul className="flex flex-col gap-2">
            {items.map((item) => (
              <SortableApplicationCard key={item.id} application={item} onOpen={onOpen} />
            ))}
          </ul>
        </SortableContext>

        {items.length === 0 && emptyHint !== undefined && (
          <p className="text-muted-foreground px-1 py-6 text-sm">{emptyHint}</p>
        )}
      </div>
    </section>
  );
}
