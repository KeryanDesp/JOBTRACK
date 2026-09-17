import type { ApplicationBoardDto, ApplicationDto } from '@jobtrack/shared';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { applicationKeys } from '../lib/query-keys';
import { MoveToMenu } from './move-to-menu';

const moveApplication = vi.hoisted(() => vi.fn());

vi.mock('@/services/api/applications', () => ({
  moveApplication,
  createApplication: vi.fn(),
  deleteApplication: vi.fn(),
  fetchApplication: vi.fn(),
  fetchApplicationBoard: vi.fn(),
  fetchApplicationStats: vi.fn(),
  fetchApplications: vi.fn(),
  updateApplication: vi.fn(),
}));

vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn() } }));

afterEach(() => {
  moveApplication.mockReset();
});

function makeApplication(overrides: Partial<ApplicationDto> = {}): ApplicationDto {
  return {
    id: 'app-1',
    jobId: null,
    status: 'TO_APPLY',
    position: 0,
    jobTitle: 'Developpeur React',
    company: 'Acme',
    locationLabel: null,
    salaryLabel: null,
    contractLabel: null,
    source: 'OTHER',
    sourceUrl: null,
    appliedAt: null,
    usedBaseResume: false,
    resumeId: null,
    coverLetterId: null,
    notes: null,
    createdAt: '2026-09-10T08:00:00.000Z',
    updatedAt: '2026-09-10T08:00:00.000Z',
    job: null,
    resume: null,
    coverLetter: null,
    ...overrides,
  };
}

function renderMenu(board: ApplicationBoardDto | null) {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false, staleTime: Infinity }, mutations: { retry: false } },
  });
  if (board !== null) client.setQueryData(applicationKeys.board, board);

  render(
    <QueryClientProvider client={client}>
      <MoveToMenu application={makeApplication()} />
    </QueryClientProvider>,
  );
}

describe('MoveToMenu', () => {
  it('propose les quatre autres colonnes, jamais celle de la candidature', async () => {
    const user = userEvent.setup();
    renderMenu(null);

    await user.click(screen.getByRole('button', { name: 'Déplacer vers…' }));

    const menu = within(screen.getByRole('menu'));
    expect(menu.getAllByRole('menuitem')).toHaveLength(4);
    for (const label of ['Candidature envoyée', 'Entretien', 'Offre', 'Refusée']) {
      expect(menu.getByRole('menuitem', { name: label })).toBeInTheDocument();
    }
    expect(menu.queryByRole('menuitem', { name: 'À postuler' })).not.toBeInTheDocument();
  });

  it('deplace en fin de colonne cible d_apres le board en cache', async () => {
    const user = userEvent.setup();
    moveApplication.mockResolvedValue(undefined);
    renderMenu({
      columns: {
        TO_APPLY: [makeApplication()],
        APPLIED: [],
        INTERVIEW: [
          makeApplication({ id: 'app-2', status: 'INTERVIEW' }),
          makeApplication({ id: 'app-3', status: 'INTERVIEW' }),
        ],
        OFFER: [],
        REJECTED: [],
      },
    });

    await user.click(screen.getByRole('button', { name: 'Déplacer vers…' }));
    await user.click(screen.getByRole('menuitem', { name: 'Entretien' }));

    await waitFor(() => {
      expect(moveApplication).toHaveBeenCalledWith('app-1', { status: 'INTERVIEW', position: 2 });
    });
  });

  it('sans board en cache, depose en position 0', async () => {
    const user = userEvent.setup();
    moveApplication.mockResolvedValue(undefined);
    renderMenu(null);

    await user.click(screen.getByRole('button', { name: 'Déplacer vers…' }));
    await user.click(screen.getByRole('menuitem', { name: 'Refusée' }));

    await waitFor(() => {
      expect(moveApplication).toHaveBeenCalledWith('app-1', { status: 'REJECTED', position: 0 });
    });
  });
});
