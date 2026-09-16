import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type * as ProfileApi from '@/services/api/profile';
import { ProfessionalCard } from './professional-card';

const fetchProfile = vi.hoisted(() => vi.fn());
const updateProfile = vi.hoisted(() => vi.fn());
vi.mock('@/services/api/profile', async () => {
  const actual = await vi.importActual<typeof ProfileApi>('@/services/api/profile');
  return { ...actual, fetchProfile, updateProfile };
});

afterEach(() => {
  fetchProfile.mockReset();
  updateProfile.mockReset();
});

const PROFILE = {
  id: 'p1',
  firstName: 'Ada',
  lastName: 'Lovelace',
  phone: null,
  city: null,
  country: null,
  title: null,
  summary: null,
  yearsExperience: null,
  avatarUrl: null,
};

function renderCard() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={client}>
      <ProfessionalCard />
    </QueryClientProvider>,
  );
}

describe('ProfessionalCard', () => {
  it('envoie firstName et lastName avec le titre lors de l_enregistrement', async () => {
    const user = userEvent.setup();
    fetchProfile.mockResolvedValue(PROFILE);
    updateProfile.mockResolvedValue({ ...PROFILE, title: 'Ingénieure' });
    renderCard();

    await user.type(await screen.findByLabelText('Titre'), 'Ingénieure');
    await user.click(screen.getByRole('button', { name: 'Enregistrer' }));

    await waitFor(() => expect(updateProfile).toHaveBeenCalled());
    expect(updateProfile.mock.calls[0]?.[0]).toEqual(
      expect.objectContaining({ firstName: 'Ada', lastName: 'Lovelace', title: 'Ingénieure' }),
    );
  });
});
