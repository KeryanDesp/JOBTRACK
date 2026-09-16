import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type * as AuthApi from '@/services/api/auth';
import { OnboardingLayout } from './onboarding-layout';

const completeOnboarding = vi.hoisted(() => vi.fn());
vi.mock('@/services/api/auth', async () => {
  const actual = await vi.importActual<typeof AuthApi>('@/services/api/auth');
  return { ...actual, completeOnboarding };
});

function RouteProbe() {
  const location = useLocation();
  return <p>Route actuelle : {location.pathname}</p>;
}

function renderLayout() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  render(
    <QueryClientProvider client={client}>
      <MemoryRouter initialEntries={['/onboarding/cv']}>
        <Routes>
          <Route
            path="/onboarding/cv"
            element={
              <OnboardingLayout step="cv">
                <p>Contenu de l_etape</p>
              </OnboardingLayout>
            }
          />
          <Route path="/profile" element={<RouteProbe />} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

afterEach(() => completeOnboarding.mockReset());

describe('OnboardingLayout', () => {
  it('confirme le passage, termine l_accueil puis redirige vers le profil', async () => {
    const user = userEvent.setup();
    completeOnboarding.mockResolvedValue(undefined);
    renderLayout();

    await user.click(screen.getByRole('button', { name: 'Passer' }));
    const dialog = await screen.findByRole('dialog');
    await user.click(within(dialog).getByRole('button', { name: 'Passer' }));

    await waitFor(() => expect(completeOnboarding).toHaveBeenCalled());
    expect(await screen.findByText('Route actuelle : /profile')).toBeInTheDocument();
  });

  it('n_affiche pas de bouton passer sur la derniere etape', () => {
    const client = new QueryClient();
    render(
      <QueryClientProvider client={client}>
        <MemoryRouter>
          <OnboardingLayout step="fin">
            <p>Contenu</p>
          </OnboardingLayout>
        </MemoryRouter>
      </QueryClientProvider>,
    );

    expect(screen.queryByRole('button', { name: 'Passer' })).not.toBeInTheDocument();
  });
});
