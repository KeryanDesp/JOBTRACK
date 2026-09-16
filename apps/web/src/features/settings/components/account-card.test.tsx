import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type * as AuthApi from '@/services/api/auth';
import { AccountCard } from './account-card';

const fetchMe = vi.hoisted(() => vi.fn());
const logout = vi.hoisted(() => vi.fn());
vi.mock('@/services/api/auth', async () => {
  const actual = await vi.importActual<typeof AuthApi>('@/services/api/auth');
  return { ...actual, fetchMe, logout };
});

afterEach(() => {
  fetchMe.mockReset();
  logout.mockReset();
});

const USER = { id: 'u1', email: 'ada@jobtrack.local', firstName: 'Ada', lastName: 'Lovelace' };

function renderCard() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <MemoryRouter initialEntries={['/settings']}>
        <Routes>
          <Route path="/settings" element={<AccountCard />} />
          <Route path="/login" element={<p>Page de connexion</p>} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

describe('AccountCard', () => {
  it('appelle logout et redirige vers la connexion au clic sur « Se déconnecter »', async () => {
    const user = userEvent.setup();
    fetchMe.mockResolvedValue(USER);
    logout.mockResolvedValue(undefined);
    renderCard();

    await user.click(await screen.findByRole('button', { name: 'Se déconnecter' }));

    await waitFor(() => expect(logout).toHaveBeenCalled());
    expect(await screen.findByText('Page de connexion')).toBeInTheDocument();
  });
});
