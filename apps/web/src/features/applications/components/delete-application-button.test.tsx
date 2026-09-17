import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { DeleteApplicationButton } from './delete-application-button';

const deleteApplication = vi.hoisted(() => vi.fn());

vi.mock('@/services/api/applications', () => ({
  deleteApplication,
  createApplication: vi.fn(),
  fetchApplication: vi.fn(),
  fetchApplicationBoard: vi.fn(),
  fetchApplicationStats: vi.fn(),
  fetchApplications: vi.fn(),
  moveApplication: vi.fn(),
  updateApplication: vi.fn(),
}));

vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn() } }));

afterEach(() => {
  deleteApplication.mockReset();
});

function renderButton() {
  const onDeleted = vi.fn();
  const client = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  render(
    <QueryClientProvider client={client}>
      <DeleteApplicationButton id="app-1" jobId="job-1" onDeleted={onDeleted} />
    </QueryClientProvider>,
  );
  return { onDeleted };
}

describe('DeleteApplicationButton', () => {
  it('demande confirmation avant toute suppression', async () => {
    const user = userEvent.setup();
    renderButton();

    await user.click(screen.getByRole('button', { name: 'Supprimer' }));

    expect(screen.getByRole('heading', { name: 'Supprimer cette candidature ?' })).toBeInTheDocument();
    expect(screen.getByText('Cette action est définitive.')).toBeInTheDocument();
    expect(deleteApplication).not.toHaveBeenCalled();
  });

  it('supprime puis previent l_appelant une fois la confirmation validee', async () => {
    const user = userEvent.setup();
    deleteApplication.mockResolvedValue(undefined);
    const { onDeleted } = renderButton();

    await user.click(screen.getByRole('button', { name: 'Supprimer' }));
    await user.click(screen.getByRole('button', { name: 'Supprimer définitivement' }));

    await waitFor(() => {
      expect(deleteApplication).toHaveBeenCalledWith('app-1');
    });
    await waitFor(() => {
      expect(onDeleted).toHaveBeenCalledTimes(1);
    });
  });

  it('previent l_appelant immediatement (fermeture optimiste), avant meme la reponse du serveur', async () => {
    const user = userEvent.setup();
    let resolveDelete: () => void = () => {};
    deleteApplication.mockImplementation(
      () =>
        new Promise<void>((resolve) => {
          resolveDelete = resolve;
        }),
    );
    const { onDeleted } = renderButton();

    await user.click(screen.getByRole('button', { name: 'Supprimer' }));
    await user.click(screen.getByRole('button', { name: 'Supprimer définitivement' }));

    // `onDeleted` et l'appel réseau sont déjà partis alors que la promesse de
    // suppression n'est pas encore résolue : la fermeture ne dépend jamais de
    // la réponse du serveur.
    expect(onDeleted).toHaveBeenCalledTimes(1);
    expect(deleteApplication).toHaveBeenCalledWith('app-1');
    expect(screen.queryByRole('heading', { name: 'Supprimer cette candidature ?' })).not.toBeInTheDocument();

    resolveDelete();
  });

  it('annuler ferme la confirmation sans rien supprimer', async () => {
    const user = userEvent.setup();
    const { onDeleted } = renderButton();

    await user.click(screen.getByRole('button', { name: 'Supprimer' }));
    await user.click(screen.getByRole('button', { name: 'Annuler' }));

    await waitFor(() => {
      expect(screen.queryByRole('heading', { name: 'Supprimer cette candidature ?' })).not.toBeInTheDocument();
    });
    expect(deleteApplication).not.toHaveBeenCalled();
    expect(onDeleted).not.toHaveBeenCalled();
  });
});
