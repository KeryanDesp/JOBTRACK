import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ProtectedRoute } from './protected-route';

afterEach(() => vi.unstubAllGlobals());

function LoginProbe() {
  const location = useLocation();
  const from = (location.state as { from?: string } | null)?.from ?? '';
  return <p>Page de connexion, origine : {from}</p>;
}

function renderProtected(initialEntry: string) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <MemoryRouter initialEntries={[initialEntry]}>
        <Routes>
          <Route element={<ProtectedRoute />}>
            <Route path="/dashboard" element={<p>Contenu protege</p>} />
          </Route>
          <Route path="/login" element={<LoginProbe />} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

describe('ProtectedRoute', () => {
  it('affiche le squelette pendant la verification de session', () => {
    vi.stubGlobal('fetch', vi.fn<typeof fetch>().mockReturnValue(new Promise(() => {})));

    renderProtected('/dashboard');

    expect(screen.getByRole('status')).toBeInTheDocument();
  });

  it('redirige vers login avec l_origine, recherche incluse, quand non connecte', async () => {
    vi.stubGlobal(
      'fetch',
      vi
        .fn<typeof fetch>()
        .mockResolvedValue(
          Response.json({ code: 'NOT_AUTHENTICATED', message: 'Non authentifié.' }, { status: 401 }),
        ),
    );

    renderProtected('/dashboard?tab=jobs');

    await waitFor(() => {
      expect(
        screen.getByText('Page de connexion, origine : /dashboard?tab=jobs'),
      ).toBeInTheDocument();
    });
  });

  it('affiche un bouton reessayer quand la verification de session echoue', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn<typeof fetch>().mockResolvedValue(Response.json({ message: 'Erreur serveur.' }, { status: 500 })),
    );

    renderProtected('/dashboard');

    await waitFor(() => {
      expect(screen.getByRole('button', { name: 'Réessayer' })).toBeInTheDocument();
    });
  });
});
