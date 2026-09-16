import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { toast } from 'sonner';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type * as AuthApi from '@/services/api/auth';
import { ApiError } from '@/services/api/client';
import { SecurityCard } from './security-card';

const changePassword = vi.hoisted(() => vi.fn());
vi.mock('@/services/api/auth', async () => {
  const actual = await vi.importActual<typeof AuthApi>('@/services/api/auth');
  return { ...actual, changePassword };
});

vi.mock('sonner', () => ({
  toast: { success: vi.fn(), error: vi.fn() },
}));

afterEach(() => {
  changePassword.mockReset();
  vi.mocked(toast.success).mockReset();
});

function renderCard() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <SecurityCard />
    </QueryClientProvider>,
  );
}

describe('SecurityCard', () => {
  it('affiche l_erreur de mot de passe actuel sur son champ puis confirme le succes', async () => {
    const user = userEvent.setup();
    changePassword.mockRejectedValueOnce(
      new ApiError('Le mot de passe actuel est incorrect.', 400, 'INVALID_CURRENT_PASSWORD'),
    );
    renderCard();

    await user.type(screen.getByLabelText('Mot de passe actuel'), 'mauvais-mot-de-passe');
    await user.type(screen.getByLabelText('Nouveau mot de passe'), 'nouveau-mot-de-passe-2026');
    await user.click(screen.getByRole('button', { name: 'Modifier le mot de passe' }));

    // Un seul element porte le message : le champ dedie, pas l'alerte generale du formulaire.
    await waitFor(() => expect(screen.getAllByText('Le mot de passe actuel est incorrect.')).toHaveLength(1));
    expect(screen.getByLabelText('Mot de passe actuel')).toHaveAccessibleDescription(
      'Le mot de passe actuel est incorrect.',
    );

    changePassword.mockResolvedValueOnce(undefined);
    await user.clear(screen.getByLabelText('Mot de passe actuel'));
    await user.type(screen.getByLabelText('Mot de passe actuel'), 'ancien-mot-de-passe-2026');
    await user.click(screen.getByRole('button', { name: 'Modifier le mot de passe' }));

    await waitFor(() => expect(toast.success).toHaveBeenCalled());
    expect(screen.getByLabelText('Mot de passe actuel')).toHaveValue('');
    expect(screen.getByLabelText('Nouveau mot de passe')).toHaveValue('');
  });
});
