import { useState } from 'react';
import type {
  Announcements,
  DragEndEvent,
  DragStartEvent,
  ScreenReaderInstructions,
  UniqueIdentifier,
} from '@dnd-kit/core';
import {
  closestCorners,
  DndContext,
  DragOverlay,
  KeyboardSensor,
  PointerSensor,
  useSensor,
  useSensors,
} from '@dnd-kit/core';
import { sortableKeyboardCoordinates } from '@dnd-kit/sortable';
import type { ApplicationBoardDto, ApplicationDto, ApplicationStatus } from '@jobtrack/shared';
import { APPLICATION_STATUSES, APPLICATION_STATUS_LABELS } from '@jobtrack/shared';
import { ErrorState } from '@/components/shared/error-state';
import { Skeleton } from '@/components/ui/skeleton';
import { useApplicationsBoard, useMoveApplication } from '../hooks/use-applications';
import { ApplicationCard, usePrefersReducedMotion } from './application-card';
import { BoardColumn } from './board-column';

// ---------------------------------------------------------------------------
// Résolution du dépôt (pure, testée seule)
// ---------------------------------------------------------------------------

export interface DropTarget {
  status: ApplicationStatus;
  position: number;
}

interface CardLocation {
  status: ApplicationStatus;
  index: number;
}

function isApplicationStatus(value: string): value is ApplicationStatus {
  return (APPLICATION_STATUSES as readonly string[]).includes(value);
}

function locateCard(board: ApplicationBoardDto, id: string): CardLocation | null {
  for (const status of APPLICATION_STATUSES) {
    const index = board.columns[status].findIndex((item) => item.id === id);
    if (index !== -1) return { status, index };
  }
  return null;
}

function findCard(board: ApplicationBoardDto, id: string): ApplicationDto | null {
  const location = locateCard(board, id);
  if (location === null) return null;
  return board.columns[location.status][location.index] ?? null;
}

/**
 * Traduit un dépôt `@dnd-kit` en `{ status, position }` pour
 * `PATCH /applications/:id/move` (spec §6), ou `null` quand rien ne change.
 *
 * Deux natures d'identifiant de cible : une colonne (`over.id` vaut alors un
 * `ApplicationStatus`, dépôt dans le vide de la colonne → fin de colonne) ou
 * une carte (insertion à la place de cette carte). Dans une même colonne, la
 * position renvoyée est l'index de la carte survolée **dans la colonne
 * d'origine, carte déplacée comprise** : c'est exactement la convention
 * d'`arrayMove`, que `moveCardInBoard` (retrait puis insertion) reproduit.
 */
export function resolveDrop(board: ApplicationBoardDto, activeId: string, overId: string): DropTarget | null {
  const from = locateCard(board, activeId);
  if (from === null) return null;
  if (overId === activeId) return null;

  if (isApplicationStatus(overId)) {
    // Retomber sur sa propre colonne (hors de toute carte) ne réordonne rien :
    // la carte garderait sa place, inutile d'écrire au serveur.
    if (overId === from.status) return null;
    return { status: overId, position: board.columns[overId].length };
  }

  const over = locateCard(board, overId);
  if (over === null) return null;
  return { status: over.status, position: over.index };
}

interface DropDescription {
  label: string;
  position: number;
  total: number;
}

/** Même résolution, formulée pour les annonces `aria-live` (positions à partir de 1). */
function describeDrop(board: ApplicationBoardDto, activeId: string, overId: string): DropDescription | null {
  const target = resolveDrop(board, activeId, overId);
  const from = locateCard(board, activeId);
  if (target === null || from === null) return null;

  const column = board.columns[target.status];
  // Colonne d'arrivée différente : la carte s'y ajoute, le total gagne une unité.
  const total = from.status === target.status ? column.length : column.length + 1;
  return { label: APPLICATION_STATUS_LABELS[target.status], position: target.position + 1, total };
}

const screenReaderInstructions: ScreenReaderInstructions = {
  draggable:
    "Pour déplacer une candidature, placez le focus sur sa poignée puis appuyez sur la barre d'espace ou sur Entrée. " +
    'Utilisez les flèches pour choisir la colonne et la position, puis appuyez de nouveau sur la barre ' +
    "d'espace ou sur Entrée pour déposer. Appuyez sur Échap pour annuler.",
};

// ---------------------------------------------------------------------------
// Vue Kanban
// ---------------------------------------------------------------------------

interface ApplicationsBoardProps {
  onOpen: (id: string) => void;
}

export function ApplicationsBoard({ onOpen }: ApplicationsBoardProps) {
  const { data, isPending, isError, refetch } = useApplicationsBoard();
  const move = useMoveApplication();
  const reducedMotion = usePrefersReducedMotion();
  const [activeId, setActiveId] = useState<UniqueIdentifier | null>(null);

  const sensors = useSensors(
    // 6 px avant de saisir : un simple clic sur le corps de la carte doit
    // ouvrir la fiche, pas démarrer un déplacement (spec §2).
    useSensor(PointerSensor, { activationConstraint: { distance: 6 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  );

  function cardTitle(id: UniqueIdentifier): string {
    const card = data === undefined ? null : findCard(data, String(id));
    return card === null ? 'sans titre' : card.jobTitle;
  }

  const announcements: Announcements = {
    onDragStart: ({ active }) => `Candidature ${cardTitle(active.id)} saisie.`,
    onDragOver: ({ active, over }) => {
      if (data === undefined || over === null) return undefined;
      const drop = describeDrop(data, String(active.id), String(over.id));
      return drop === null ? undefined : `Déplacée dans ${drop.label}, position ${drop.position} sur ${drop.total}.`;
    },
    onDragEnd: ({ active, over }) => {
      if (data === undefined || over === null) return 'Déplacement annulé.';
      const drop = describeDrop(data, String(active.id), String(over.id));
      return drop === null
        ? 'Déplacement annulé.'
        : `Déposée dans ${drop.label}, position ${drop.position} sur ${drop.total}.`;
    },
    onDragCancel: () => 'Déplacement annulé.',
  };

  function handleDragStart(event: DragStartEvent): void {
    setActiveId(event.active.id);
  }

  function handleDragEnd(event: DragEndEvent): void {
    setActiveId(null);
    const { active, over } = event;
    if (data === undefined || over === null) return;

    const target = resolveDrop(data, String(active.id), String(over.id));
    if (target === null) return;
    move.mutate({ id: String(active.id), input: target });
  }

  if (isPending) return <BoardSkeleton />;

  if (isError || data === undefined) {
    return (
      <ErrorState
        role="status"
        message="Le tableau des candidatures n'a pas pu être chargé."
        onRetry={() => void refetch()}
      />
    );
  }

  const board = data;
  const isEmpty = APPLICATION_STATUSES.every((status) => board.columns[status].length === 0);
  const activeCard = activeId === null ? null : findCard(board, String(activeId));

  return (
    <DndContext
      sensors={sensors}
      collisionDetection={closestCorners}
      accessibility={{ announcements, screenReaderInstructions }}
      onDragStart={handleDragStart}
      onDragEnd={handleDragEnd}
      onDragCancel={() => setActiveId(null)}
    >
      <div className="flex snap-x snap-mandatory gap-4 overflow-x-auto pb-4">
        {APPLICATION_STATUSES.map((status, index) => (
          <BoardColumn
            key={status}
            status={status}
            items={board.columns[status]}
            onOpen={onOpen}
            emptyHint={isEmpty && index === 0 ? 'Aucune candidature' : undefined}
          />
        ))}
      </div>

      {/* `dropAnimation={null}` : aucune animation de retombée quand l'utilisateur
          a demandé moins de mouvement (spec §7). */}
      <DragOverlay dropAnimation={reducedMotion ? null : undefined}>
        {activeCard === null ? null : <ApplicationCard application={activeCard} onOpen={onOpen} />}
      </DragOverlay>
    </DndContext>
  );
}

function BoardSkeleton() {
  return (
    <div className="flex gap-4 overflow-x-auto pb-4">
      <p role="status" className="sr-only">
        Chargement des candidatures…
      </p>
      {APPLICATION_STATUSES.map((status) => (
        <div key={status} className="w-[280px] shrink-0 md:w-auto md:flex-1" aria-hidden="true">
          <div className="flex items-center justify-between gap-2 px-1 pb-2">
            <Skeleton className="h-5 w-32" />
            <Skeleton className="h-5 w-6" />
          </div>
          <div className="bg-muted/40 flex min-h-40 flex-col gap-2 rounded-lg p-2">
            <Skeleton className="h-20 w-full" />
            <Skeleton className="h-20 w-full" />
          </div>
        </div>
      ))}
    </div>
  );
}
