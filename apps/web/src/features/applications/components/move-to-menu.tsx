import type { ApplicationBoardDto, ApplicationDto, ApplicationStatus } from '@jobtrack/shared';
import { APPLICATION_STATUSES, APPLICATION_STATUS_LABELS } from '@jobtrack/shared';
import { useQueryClient } from '@tanstack/react-query';
import { CornerDownRight } from 'lucide-react';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { useMoveApplication } from '../hooks/use-applications';
import { applicationKeys } from '../lib/query-keys';

interface MoveToMenuProps {
  application: ApplicationDto;
}

/**
 * Équivalent clavier et lecteur d'écran du glisser-déposer (spec §2) : les
 * quatre autres colonnes, la carte étant toujours ajoutée en fin de colonne
 * cible. Le nombre de cartes déjà présentes est lu dans le board en cache
 * plutôt que refetché — `useMoveApplication` réécrit ce même cache de façon
 * optimiste et le serveur réindexe la colonne de toute façon, donc une
 * position trop grande est simplement ramenée à la fin.
 */
export function MoveToMenu({ application }: MoveToMenuProps) {
  const queryClient = useQueryClient();
  const move = useMoveApplication();

  const targets = APPLICATION_STATUSES.filter((status) => status !== application.status);

  function handleMove(status: ApplicationStatus): void {
    const board = queryClient.getQueryData<ApplicationBoardDto>(applicationKeys.board);
    const position = board?.columns[status].length ?? 0;
    move.mutate({ id: application.id, input: { status, position } });
  }

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button
          type="button"
          aria-label="Déplacer vers…"
          className="text-muted-foreground hover:bg-accent hover:text-foreground focus-visible:ring-ring inline-flex size-7 items-center justify-center rounded-md focus-visible:ring-2 focus-visible:outline-none"
        >
          <CornerDownRight className="size-4" aria-hidden="true" />
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end">
        <DropdownMenuLabel>Déplacer vers…</DropdownMenuLabel>
        {targets.map((status) => (
          <DropdownMenuItem key={status} onSelect={() => handleMove(status)}>
            {APPLICATION_STATUS_LABELS[status]}
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
