import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { renderHook, waitFor } from '@testing-library/react';
import type { ReactNode } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { useSession } from './use-session';

afterEach(() => vi.unstubAllGlobals());

function renderWithClient() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const wrapper = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={client}>{children}</QueryClientProvider>
  );
  return renderHook(() => useSession(), { wrapper });
}

describe('useSession', () => {
  it('renvoie null quand l_api repond 401', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn<typeof fetch>().mockResolvedValue(
        Response.json({ code: 'NOT_AUTHENTICATED', message: 'Non authentifié.' }, { status: 401 }),
      ),
    );

    const { result } = renderWithClient();

    await waitFor(() => expect(result.current.isPending).toBe(false));
    expect(result.current.data).toBeNull();
  });

  it('renvoie l_utilisateur connecte', async () => {
    const user = { id: '1', email: 'test@example.com', firstName: 'Ada', lastName: 'Lovelace' };
    vi.stubGlobal('fetch', vi.fn<typeof fetch>().mockResolvedValue(Response.json(user)));

    const { result } = renderWithClient();

    await waitFor(() => expect(result.current.isPending).toBe(false));
    expect(result.current.data?.email).toBe('test@example.com');
  });
});
