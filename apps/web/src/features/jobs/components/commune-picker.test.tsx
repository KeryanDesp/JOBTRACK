import type { CommuneDto } from '@jobtrack/shared';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useState } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { CommunePicker } from './commune-picker';

const searchCommunes = vi.hoisted(() => vi.fn());

vi.mock('@/services/api/jobs', () => ({
  searchCommunes,
  saveJob: vi.fn(),
  unsaveJob: vi.fn(),
  fetchJob: vi.fn(),
  fetchJobsCapabilities: vi.fn(),
  fetchSavedJobs: vi.fn(),
  searchJobs: vi.fn(),
}));

afterEach(() => searchCommunes.mockReset());

const METZ: CommuneDto = { code: '57463', name: 'Metz', postalCode: '57000', departmentCode: '57' };
const NANCY: CommuneDto = { code: '54395', name: 'Nancy', postalCode: '54000', departmentCode: '54' };
const PARIS: CommuneDto = { code: '75056', name: 'Paris', postalCode: '75000', departmentCode: '75' };

function Harness() {
  const [value, setValue] = useState<CommuneDto[]>([]);
  return <CommunePicker value={value} onChange={setValue} />;
}

function renderPicker() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={client}>
      <Harness />
    </QueryClientProvider>,
  );
}

describe('CommunePicker', () => {
  it('selectionne une commune proposee et l_ajoute comme puce retirable', async () => {
    searchCommunes.mockResolvedValue([METZ]);
    const user = userEvent.setup();
    renderPicker();

    await user.type(screen.getByRole('combobox'), 'Metz');

    const option = await screen.findByRole('option', { name: /Metz/ });
    await user.click(option);

    expect(await screen.findByRole('button', { name: 'Retirer Metz' })).toBeInTheDocument();
    expect(screen.getByRole('combobox')).toHaveValue('');
  });

  it('affiche un message lie par aria-describedby une fois trois lieux atteints, sans desactiver la saisie', async () => {
    searchCommunes.mockResolvedValueOnce([METZ]).mockResolvedValueOnce([NANCY]).mockResolvedValueOnce([PARIS]);
    const user = userEvent.setup();
    renderPicker();

    for (const label of ['Metz', 'Nancy', 'Paris']) {
      await user.type(screen.getByRole('combobox'), label);
      const option = await screen.findByRole('option', { name: new RegExp(label) });
      await user.click(option);
      await waitFor(() => expect(screen.getByRole('combobox')).toHaveValue(''));
    }

    const hint = await screen.findByText('Trois lieux maximum.');
    const combobox = screen.getByRole('combobox');
    // Reste focusable (pas `disabled`, qui la retirerait de l'ordre de tabulation) :
    // le message explique juste pourquoi une nouvelle saisie n'aura pas d'effet.
    expect(combobox).not.toBeDisabled();
    expect(combobox).toHaveAttribute('aria-describedby', hint.id);
  });

  it('renvoie le focus sur le champ de recherche apres le retrait d_une puce', async () => {
    searchCommunes.mockResolvedValue([METZ]);
    const user = userEvent.setup();
    renderPicker();

    await user.type(screen.getByRole('combobox'), 'Metz');
    const option = await screen.findByRole('option', { name: /Metz/ });
    await user.click(option);

    await user.click(await screen.findByRole('button', { name: 'Retirer Metz' }));

    expect(screen.getByRole('combobox')).toHaveFocus();
  });

  it('affiche un message quand aucune commune ne correspond', async () => {
    searchCommunes.mockResolvedValue([]);
    const user = userEvent.setup();
    renderPicker();

    await user.type(screen.getByRole('combobox'), 'Introuvable');

    expect(await screen.findByText('Aucune commune trouvée.')).toBeInTheDocument();
  });
});
