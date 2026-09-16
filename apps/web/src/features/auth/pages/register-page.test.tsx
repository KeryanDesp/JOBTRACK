import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { RegisterPage } from './register-page';

const register = vi.hoisted(() => vi.fn());
vi.mock('@/services/api/auth', () => ({ register, startGoogleLogin: vi.fn() }));

function renderPage() {
  render(
    <QueryClientProvider client={new QueryClient()}>
      <MemoryRouter initialEntries={['/register']}>
        <RegisterPage />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

beforeEach(() => register.mockReset());

describe('RegisterPage', () => {
  it('soumet les quatre champs et ouvre la session', async () => {
    const user = userEvent.setup();
    register.mockResolvedValue({ id: '1', email: 'ada@example.com', firstName: 'Ada', lastName: 'Lovelace' });
    renderPage();

    await user.type(screen.getByLabelText('Prénom'), 'Ada');
    await user.type(screen.getByLabelText('Nom'), 'Lovelace');
    await user.type(screen.getByLabelText('Email'), 'ada@example.com');
    await user.type(screen.getByLabelText('Mot de passe'), 'un-mot-de-passe-de-douze');
    await user.click(screen.getByRole('button', { name: 'Créer mon compte' }));

    // Second argument = contexte interne de TanStack Query (`{ client, meta,
    // mutationKey }`), pas quelque chose que notre code contrôle : on ne
    // vérifie que le premier.
    await waitFor(() => {
      expect(register.mock.calls[0]?.[0]).toEqual({
        firstName: 'Ada',
        lastName: 'Lovelace',
        email: 'ada@example.com',
        password: 'un-mot-de-passe-de-douze',
      });
    });
  });
});
