import type { ReactNode } from 'react';
import type * as DndKitCore from '@dnd-kit/core';
import type { DragEndEvent, DndContextProps } from '@dnd-kit/core';
import type { ApplicationBoardDto, ApplicationDto, ApplicationStatus } from '@jobtrack/shared';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ApiError } from '@/services/api/client';
import { applicationKeys } from '../lib/query-keys';
import { ApplicationsBoard, resolveDrop } from './applications-board';

// `DndContext` est remplacé par un passe-plat qui capture ses props : la
// simulation d'un vrai glisser-déposer (pointeur, mesures de rectangles,
// détection de collision) est impossible sous jsdom, alors que le contrat
// réellement testable du board est « ce que fait `onDragEnd` ». Les hooks
// (`useDroppable`, `useSortable`) restent ceux de la vraie bibliothèque.
const dnd = vi.hoisted(() => ({ props: null as DndContextProps | null }));

vi.mock('@dnd-kit/core', async (importOriginal) => {
  const actual = await importOriginal<typeof DndKitCore>();
  return {
    ...actual,
    DndContext: (props: DndContextProps): ReactNode => {
      dnd.props = props;
      return props.children;
    },
    DragOverlay: ({ children }: { children?: ReactNode }): ReactNode => children,
  };
});

const fetchApplicationBoard = vi.hoisted(() => vi.fn());
const moveApplication = vi.hoisted(() => vi.fn());

vi.mock('@/services/api/applications', () => ({
  fetchApplicationBoard,
  moveApplication,
  createApplication: vi.fn(),
  deleteApplication: vi.fn(),
  fetchApplication: vi.fn(),
  fetchApplicationStats: vi.fn(),
  fetchApplications: vi.fn(),
  updateApplication: vi.fn(),
}));

vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn() } }));

afterEach(() => {
  fetchApplicationBoard.mockReset();
  moveApplication.mockReset();
  dnd.props = null;
});

function makeApplication(overrides: Partial<ApplicationDto> = {}): ApplicationDto {
  return {
    id: 'app-1',
    jobId: null,
    status: 'TO_APPLY',
    position: 0,
    jobTitle: 'Developpeur React',
    company: 'Acme',
    locationLabel: 'Metz (57)',
    salaryLabel: '45–55 k€',
    contractLabel: 'CDI',
    source: 'LINKEDIN',
    sourceUrl: null,
    appliedAt: '2026-09-15',
    usedBaseResume: false,
    resumeId: null,
    coverLetterId: null,
    notes: null,
    createdAt: '2026-09-10T08:00:00.000Z',
    updatedAt: '2026-09-15T08:00:00.000Z',
    job: null,
    resume: null,
    coverLetter: null,
    ...overrides,
  };
}

function makeBoard(columns: Partial<Record<ApplicationStatus, ApplicationDto[]>> = {}): ApplicationBoardDto {
  return {
    columns: {
      TO_APPLY: columns.TO_APPLY ?? [],
      APPLIED: columns.APPLIED ?? [],
      INTERVIEW: columns.INTERVIEW ?? [],
      OFFER: columns.OFFER ?? [],
      REJECTED: columns.REJECTED ?? [],
    },
  };
}

/** Évènement minimal : seuls `active.id` et `over.id` sont lus par le board. */
function dragEnd(activeId: string, overId: string | null): DragEndEvent {
  return {
    active: { id: activeId },
    over: overId === null ? null : { id: overId },
    activatorEvent: new Event('keydown'),
    collisions: null,
    delta: { x: 0, y: 0 },
  } as unknown as DragEndEvent;
}

function renderBoard(board: ApplicationBoardDto | null) {
  const onOpen = vi.fn();
  const client = new QueryClient({
    defaultOptions: {
      // `staleTime: Infinity` : le board pré-semé ne doit pas relancer une
      // requête de fond pendant l'assertion.
      queries: { retry: false, staleTime: Infinity },
      mutations: { retry: false },
    },
  });
  if (board !== null) client.setQueryData(applicationKeys.board, board);

  const utils = render(
    <QueryClientProvider client={client}>
      <ApplicationsBoard onOpen={onOpen} />
    </QueryClientProvider>,
  );
  return { ...utils, onOpen, client };
}

describe('resolveDrop', () => {
  const board = makeBoard({
    TO_APPLY: [makeApplication({ id: 'a' }), makeApplication({ id: 'b' }), makeApplication({ id: 'c' })],
    INTERVIEW: [
      makeApplication({ id: 'x', status: 'INTERVIEW' }),
      makeApplication({ id: 'y', status: 'INTERVIEW' }),
    ],
  });

  it('depot sur une colonne vide : position en fin de colonne', () => {
    expect(resolveDrop(board, 'a', 'OFFER')).toEqual({ status: 'OFFER', position: 0 });
  });

  it('depot sur une autre colonne deja peuplee : position apres les cartes existantes', () => {
    expect(resolveDrop(board, 'a', 'INTERVIEW')).toEqual({ status: 'INTERVIEW', position: 2 });
  });

  it('depot sur une carte plus bas dans la meme colonne', () => {
    expect(resolveDrop(board, 'a', 'c')).toEqual({ status: 'TO_APPLY', position: 2 });
  });

  it('depot sur une carte plus haut dans la meme colonne', () => {
    expect(resolveDrop(board, 'c', 'a')).toEqual({ status: 'TO_APPLY', position: 0 });
  });

  it('depot sur une carte d_une autre colonne : insertion a la place de cette carte', () => {
    expect(resolveDrop(board, 'a', 'y')).toEqual({ status: 'INTERVIEW', position: 1 });
  });

  it('depot sur sa propre carte : aucun changement', () => {
    expect(resolveDrop(board, 'a', 'a')).toBeNull();
  });

  it('depot dans le vide de sa propre colonne : aucun changement', () => {
    expect(resolveDrop(board, 'a', 'TO_APPLY')).toBeNull();
  });

  it('identifiant actif inconnu : aucun changement', () => {
    expect(resolveDrop(board, 'inconnu', 'INTERVIEW')).toBeNull();
  });

  it('cible inconnue : aucun changement', () => {
    expect(resolveDrop(board, 'a', 'inconnu')).toBeNull();
  });
});

describe('ApplicationsBoard', () => {
  it('rend les cinq colonnes dans l_ordre du contrat avec leurs cartes', () => {
    renderBoard(
      makeBoard({
        TO_APPLY: [makeApplication({ id: 'app-1', company: 'Acme' })],
        INTERVIEW: [makeApplication({ id: 'app-2', status: 'INTERVIEW', company: 'Globex' })],
      }),
    );

    const headings = screen.getAllByRole('heading', { level: 3 }).map((node) => node.textContent);
    expect(headings).toEqual(['À postuler', 'Candidature envoyée', 'Entretien', 'Offre', 'Refusée']);
    expect(screen.getByText('Acme')).toBeInTheDocument();
    expect(screen.getByText('Globex')).toBeInTheDocument();
  });

  it('affiche cinq colonnes de squelettes pendant le chargement', () => {
    fetchApplicationBoard.mockReturnValue(new Promise(() => {}));
    const { container } = renderBoard(null);

    expect(screen.getByRole('status')).toHaveTextContent('Chargement des candidatures…');
    expect(container.querySelectorAll('[data-slot="skeleton"]').length).toBe(20);
  });

  it('affiche un message d_erreur et un bouton Reessayer', async () => {
    fetchApplicationBoard.mockRejectedValue(new ApiError('Indisponible', 500));
    renderBoard(null);

    expect(
      await screen.findByText("Le tableau des candidatures n'a pas pu être chargé."),
    ).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Réessayer' })).toBeInTheDocument();
  });

  it('board vide : les colonnes restent affichees avec l_indice dans la premiere', () => {
    renderBoard(makeBoard());

    expect(screen.getAllByRole('heading', { level: 3 })).toHaveLength(5);
    expect(screen.getAllByText('Aucune candidature')).toHaveLength(1);
  });

  it('un depot sur une autre colonne appelle PATCH move avec le statut et la position', async () => {
    moveApplication.mockResolvedValue(undefined);
    renderBoard(
      makeBoard({
        TO_APPLY: [makeApplication({ id: 'app-1' })],
        INTERVIEW: [makeApplication({ id: 'app-2', status: 'INTERVIEW' })],
      }),
    );

    act(() => {
      dnd.props?.onDragEnd?.(dragEnd('app-1', 'INTERVIEW'));
    });

    await waitFor(() => {
      expect(moveApplication).toHaveBeenCalledWith('app-1', { status: 'INTERVIEW', position: 1 });
    });
  });

  it('un depot qui ne change rien n_appelle pas PATCH move', () => {
    renderBoard(makeBoard({ TO_APPLY: [makeApplication({ id: 'app-1' })] }));

    act(() => {
      dnd.props?.onDragEnd?.(dragEnd('app-1', 'TO_APPLY'));
    });
    act(() => {
      dnd.props?.onDragEnd?.(dragEnd('app-1', null));
    });

    expect(moveApplication).not.toHaveBeenCalled();
  });

  it('les annonces de lecteur d_ecran sont en francais', () => {
    renderBoard(
      makeBoard({
        TO_APPLY: [makeApplication({ id: 'app-1', jobTitle: 'Developpeur React' })],
        INTERVIEW: [makeApplication({ id: 'app-2', status: 'INTERVIEW' })],
      }),
    );

    const announcements = dnd.props?.accessibility?.announcements;
    const arg = dragEnd('app-1', 'INTERVIEW');
    expect(announcements?.onDragStart({ active: arg.active })).toBe('Candidature Developpeur React saisie.');
    expect(announcements?.onDragOver({ active: arg.active, over: arg.over })).toBe(
      'Déplacée dans Entretien, position 2 sur 2.',
    );
    expect(announcements?.onDragEnd({ active: arg.active, over: arg.over })).toBe(
      'Déposée dans Entretien, position 2 sur 2.',
    );
    expect(announcements?.onDragCancel({ active: arg.active, over: null })).toBe('Déplacement annulé.');
    expect(dnd.props?.accessibility?.screenReaderInstructions?.draggable).toContain('Échap');
  });

  it('un clic sur le corps d_une carte remonte son identifiant', async () => {
    const user = userEvent.setup();
    const { onOpen } = renderBoard(makeBoard({ TO_APPLY: [makeApplication({ id: 'app-1' })] }));

    await user.click(screen.getByRole('button', { name: 'Ouvrir la candidature Developpeur React' }));

    expect(onOpen).toHaveBeenCalledWith('app-1');
  });
});
