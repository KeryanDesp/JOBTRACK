import type { ActiveSession } from '@jobtrack/shared';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type * as AuthApi from '@/services/api/auth';
import { SessionsCard } from './sessions-card';

const fetchSessions = vi.hoisted(() => vi.fn());
const revokeSession = vi.hoisted(() => vi.fn());
vi.mock('@/services/api/auth', async () => {
  const actual = await vi.importActual<typeof AuthApi>('@/services/api/auth');
  return { ...actual, fetchSessions, revokeSession };
});

afterEach(() => {
  fetchSessions.mockReset();
  revokeSession.mockReset();
});

const SESSIONS: ActiveSession[] = [
  { id: 'a', current: true, userAgent: 'appareil-a', ip: '1.1.1.1', createdAt: '2026-01-01T00:00:00.000Z', lastSeenAt: '2026-01-01T00:00:00.000Z' },
  { id: 'b', current: false, userAgent: 'appareil-b', ip: '2.2.2.2', createdAt: '2026-01-01T00:00:00.000Z', lastSeenAt: '2026-01-01T00:00:00.000Z' },
];

function renderCard() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <SessionsCard />
    </QueryClientProvider>,
  );
}

describe('SessionsCard', () => {
  it('revoque une session distante au clic sur « Déconnecter »', async () => {
    const user = userEvent.setup();
    fetchSessions.mockResolvedValue(SESSIONS);
    revokeSession.mockResolvedValue(undefined);
    renderCard();

    expect(await screen.findByText('Session actuelle')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Déconnecter' }));

    await waitFor(() => expect(revokeSession).toHaveBeenCalledWith('b'));
  });
});
