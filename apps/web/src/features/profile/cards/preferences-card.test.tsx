import type { JobPreferencesFormInput } from '@jobtrack/shared';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type * as ProfileApi from '@/services/api/profile';
import { PreferencesCard } from './preferences-card';

const fetchPreferences = vi.hoisted(() => vi.fn());
const updatePreferences = vi.hoisted(() => vi.fn());
vi.mock('@/services/api/profile', async () => {
  const actual = await vi.importActual<typeof ProfileApi>('@/services/api/profile');
  return { ...actual, fetchPreferences, updatePreferences };
});

afterEach(() => {
  fetchPreferences.mockReset();
  updatePreferences.mockReset();
});

const PREFERENCES = {
  id: 'pref1',
  desiredRoles: ['Développeuse'],
  desiredCategories: ['Tech'],
  salaryMin: null,
  salaryMax: null,
  currency: 'EUR',
  locations: ['Paris'],
  searchRadiusKm: 25,
  remoteModes: ['REMOTE'] as const,
  contractTypes: ['CDI'] as const,
  availability: null,
  experienceLevel: null,
};

function renderCard() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={client}>
      <PreferencesCard />
    </QueryClientProvider>,
  );
}

describe('PreferencesCard', () => {
  it('envoie les cinq tableaux et omet experienceLevel quand il est non precise', async () => {
    const user = userEvent.setup();
    fetchPreferences.mockResolvedValue(PREFERENCES);
    updatePreferences.mockResolvedValue(PREFERENCES);
    renderCard();

    await screen.findByDisplayValue('EUR');
    // Le bouton reste desactive tant que le formulaire n'est pas modifie (`isDirty`) :
    // une frappe neutre sur un champ non verifie par cette assertion suffit a l'activer.
    await user.type(screen.getByLabelText('Disponibilité'), 'Immédiatement');
    await user.click(screen.getByRole('button', { name: 'Enregistrer' }));

    await waitFor(() => expect(updatePreferences).toHaveBeenCalled());
    const body = updatePreferences.mock.calls[0]?.[0] as JobPreferencesFormInput;
    expect(body).toEqual(
      expect.objectContaining({
        desiredRoles: ['Développeuse'],
        desiredCategories: ['Tech'],
        locations: ['Paris'],
        remoteModes: ['REMOTE'],
        contractTypes: ['CDI'],
      }),
    );
    // `experienceLevel` vaut `undefined` (React Hook Form garde toute clé enregistrée dans
    // `getValues()`) mais `JSON.stringify` — utilisé par `apiRequest` pour construire le
    // corps réel de la requête — l'élimine : c'est ce comportement précis que PATCH exploite
    // pour laisser un champ omis inchangé côté serveur.
    expect(body.experienceLevel).toBeUndefined();
    expect(JSON.parse(JSON.stringify(body))).not.toHaveProperty('experienceLevel');
  });

  it('suggere des postes a partir d_un domaine et enchaine les choix', async () => {
    const user = userEvent.setup();
    fetchPreferences.mockResolvedValue({ ...PREFERENCES, desiredRoles: [], desiredCategories: [] });
    updatePreferences.mockResolvedValue(PREFERENCES);
    renderCard();

    const roles = await screen.findByLabelText('Postes recherchés');
    expect(screen.queryByRole('group', { name: 'Suggestions de postes' })).not.toBeInTheDocument();

    await user.type(roles, 'informatique');
    const group = screen.getByRole('group', { name: 'Suggestions de postes' });
    await user.click(within(group).getByRole('button', { name: 'Développeur mobile' }));

    expect(roles).toHaveValue('Développeur mobile, ');
    expect(roles).toHaveFocus();
    // Le champ vide après la virgule : la suite de la même catégorie, sans le poste choisi.
    const next = screen.getByRole('group', { name: 'Suggestions de postes' });
    expect(within(next).queryByRole('button', { name: 'Développeur mobile' })).not.toBeInTheDocument();
    await user.click(within(next).getByRole('button', { name: 'Développeur iOS' }));

    await user.click(screen.getByRole('button', { name: 'Enregistrer' }));
    await waitFor(() => expect(updatePreferences).toHaveBeenCalled());
    const body = updatePreferences.mock.calls[0]?.[0] as JobPreferencesFormInput;
    expect(body.desiredRoles).toEqual(['Développeur mobile', 'Développeur iOS']);
  });

  it('suggere des categories a la frappe', async () => {
    const user = userEvent.setup();
    fetchPreferences.mockResolvedValue({ ...PREFERENCES, desiredCategories: [] });
    renderCard();

    await user.type(await screen.findByLabelText('Catégories recherchées'), 'info');
    const group = screen.getByRole('group', { name: 'Suggestions de catégories' });
    await user.click(within(group).getByRole('button', { name: 'Informatique' }));

    expect(screen.getByLabelText('Catégories recherchées')).toHaveValue('Informatique, ');
  });
});
