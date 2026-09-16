import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ApiError } from '@/services/api/client';
import { LoginPage } from './login-page';

const login = vi.hoisted(() => vi.fn());
vi.mock('@/services/api/auth', () => ({ login, startGoogleLogin: vi.fn() }));

function RouteProbe() {
  const location = useLocation();
  return <p>Route actuelle : {location.pathname}</p>;
}

function renderPage(initialEntry: string | { pathname: string; state?: unknown } = '/login') {
  render(
    <QueryClientProvider client={new QueryClient()}>
      <MemoryRouter initialEntries={[initialEntry]}>
        <Routes>
          <Route path="/login" element={<LoginPage />} />
          <Route path="/onboarding" element={<RouteProbe />} />
          <Route path="/profile" element={<RouteProbe />} />
          <Route path="/settings" element={<RouteProbe />} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

// `afterEach`, pas `beforeEach` : sur cette version de Vitest, réinitialiser
// le mock hoisté dans un hook qui s'exécute *avant* le corps du test décale
// le suivi du rejet de promesse d'un tick et le fait remonter comme rejet
// non géré du test suivant, même si `onError` le traite bien (constaté en
// isolant un composant minimal identique — pas un bug de LoginPage).
afterEach(() => login.mockReset());

describe('LoginPage', () => {
  it('refuse un email malforme sans appeler l_api', async () => {
    const user = userEvent.setup();
    renderPage();

    await user.type(screen.getByLabelText('Email'), 'pas-un-email');
    await user.type(screen.getByLabelText('Mot de passe'), 'un-mot-de-passe-valide');
    await user.click(screen.getByRole('button', { name: 'Se connecter' }));

    expect(await screen.findByText('Adresse email invalide.')).toBeInTheDocument();
    expect(login).not.toHaveBeenCalled();
  });

  it('soumet les identifiants valides', async () => {
    const user = userEvent.setup();
    login.mockResolvedValue({
      id: '1',
      email: 'ada@example.com',
      firstName: 'Ada',
      lastName: 'Lovelace',
      onboardingCompleted: true,
    });
    renderPage();

    await user.type(screen.getByLabelText('Email'), 'ada@example.com');
    await user.type(screen.getByLabelText('Mot de passe'), 'un-mot-de-passe-valide');
    await user.click(screen.getByRole('button', { name: 'Se connecter' }));

    // `login` (le mock) reçoit aussi le contexte interne de TanStack Query
    // (`{ client, meta, mutationKey }`) en second argument : on ne vérifie
    // donc que le premier, celui que notre code contrôle réellement.
    await waitFor(() => {
      expect(login.mock.calls[0]?.[0]).toEqual({ email: 'ada@example.com', password: 'un-mot-de-passe-valide' });
    });
  });

  it('redirige vers l_onboarding quand il n_est pas termine et qu_il n_y a pas d_origine', async () => {
    const user = userEvent.setup();
    login.mockResolvedValue({
      id: '1',
      email: 'ada@example.com',
      firstName: 'Ada',
      lastName: 'Lovelace',
      onboardingCompleted: false,
    });
    renderPage();

    await user.type(screen.getByLabelText('Email'), 'ada@example.com');
    await user.type(screen.getByLabelText('Mot de passe'), 'un-mot-de-passe-valide');
    await user.click(screen.getByRole('button', { name: 'Se connecter' }));

    expect(await screen.findByText('Route actuelle : /onboarding')).toBeInTheDocument();
  });

  it('redirige vers l_origine memorisee meme si l_onboarding n_est pas termine', async () => {
    const user = userEvent.setup();
    login.mockResolvedValue({
      id: '1',
      email: 'ada@example.com',
      firstName: 'Ada',
      lastName: 'Lovelace',
      onboardingCompleted: false,
    });
    renderPage({ pathname: '/login', state: { from: '/settings' } });

    await user.type(screen.getByLabelText('Email'), 'ada@example.com');
    await user.type(screen.getByLabelText('Mot de passe'), 'un-mot-de-passe-valide');
    await user.click(screen.getByRole('button', { name: 'Se connecter' }));

    expect(await screen.findByText('Route actuelle : /settings')).toBeInTheDocument();
  });

  it('affiche le message d_erreur renvoye par le serveur', async () => {
    const user = userEvent.setup();
    login.mockRejectedValue(new ApiError('Identifiants invalides.', 401, 'INVALID_CREDENTIALS'));
    renderPage();

    await user.type(screen.getByLabelText('Email'), 'ada@example.com');
    await user.type(screen.getByLabelText('Mot de passe'), 'un-mot-de-passe-valide');
    await user.click(screen.getByRole('button', { name: 'Se connecter' }));

    expect(await screen.findByRole('alert')).toHaveTextContent('Identifiants invalides.');
  });

  it('affiche le message d_erreur google issu de l_url', () => {
    renderPage('/login?error=google_link');

    expect(screen.getByRole('status')).toHaveTextContent(
      'Un compte existe déjà avec cette adresse. Connectez-vous par mot de passe pour le relier à Google.',
    );
  });
});
