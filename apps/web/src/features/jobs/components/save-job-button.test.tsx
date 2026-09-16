import { QueryClient, QueryClientProvider, useQuery } from '@tanstack/react-query';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { toast } from 'sonner';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ApiError } from '@/services/api/client';
import { jobKeys } from '../lib/query-keys';
import { SaveJobButton } from './save-job-button';

const saveJob = vi.hoisted(() => vi.fn());

vi.mock('@/services/api/jobs', () => ({
  saveJob,
  unsaveJob: vi.fn(),
  fetchJob: vi.fn(),
  fetchJobsCapabilities: vi.fn(),
  fetchSavedJobs: vi.fn(),
  searchCommunes: vi.fn(),
  searchJobs: vi.fn(),
}));

vi.mock('sonner', () => ({
  toast: { success: vi.fn(), error: vi.fn() },
}));

afterEach(() => {
  saveJob.mockReset();
  vi.mocked(toast.error).mockReset();
});

/**
 * `SaveJobButton` reçoit `saved` en prop, contrôlé par l'appelant réel
 * (`JobCard`) depuis le cache TanStack Query. Ce harnais reproduit cette
 * subscription minimale sur `jobKeys.detail` pour que la mise à jour
 * optimiste faite par `useSaveJob` (dans `onMutate`) se reflète bien dans le
 * `saved` affiché, exactement comme dans l'application réelle.
 */
function Harness({ jobId }: { jobId: string }) {
  const query = useQuery<{ saved: boolean }>({
    queryKey: jobKeys.detail(jobId),
    queryFn: () => Promise.resolve({ saved: false }),
    enabled: false,
  });
  return <SaveJobButton jobId={jobId} saved={query.data?.saved ?? false} />;
}

function renderButton(saved: boolean) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  client.setQueryData(jobKeys.detail('job-1'), { saved });
  render(
    <QueryClientProvider client={client}>
      <Harness jobId="job-1" />
    </QueryClientProvider>,
  );
}

describe('SaveJobButton', () => {
  it('bascule aria-pressed de facon optimiste avant la reponse serveur', async () => {
    // Promesse jamais résolue dans ce test : on vérifie l'état affiché avant toute réponse.
    saveJob.mockReturnValue(new Promise<void>(() => {}));
    const user = userEvent.setup();
    renderButton(false);

    const button = screen.getByRole('button', { name: "Sauvegarder l'offre" });
    expect(button).toHaveAttribute('aria-pressed', 'false');

    await user.click(button);

    await waitFor(() => {
      expect(screen.getByRole('button', { name: 'Retirer des favoris' })).toHaveAttribute('aria-pressed', 'true');
    });
  });

  it('affiche un toast d_erreur et revient a l_etat initial si la requete echoue', async () => {
    saveJob.mockRejectedValue(new Error('boom'));
    const user = userEvent.setup();
    renderButton(false);

    await user.click(screen.getByRole('button', { name: "Sauvegarder l'offre" }));

    await waitFor(() => {
      expect(screen.getByRole('button', { name: "Sauvegarder l'offre" })).toHaveAttribute('aria-pressed', 'false');
    });
  });

  it('affiche un message dedie sans indication de reessai quand l_offre n_existe plus', async () => {
    saveJob.mockRejectedValue(new ApiError("L'offre n'existe plus.", 404, 'JOB_NOT_FOUND'));
    const user = userEvent.setup();
    renderButton(false);

    await user.click(screen.getByRole('button', { name: "Sauvegarder l'offre" }));

    await waitFor(() => expect(toast.error).toHaveBeenCalledWith("Cette offre n'existe plus."));
  });
});
