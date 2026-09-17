import { JOB_SORT_OPTIONS } from '@jobtrack/shared';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeAll, describe, expect, it, vi } from 'vitest';
import { JobSortSelect } from './job-sort-select';

// jsdom n'implémente pas `scrollIntoView`, que Radix Select appelle pour faire
// défiler l'option active en vue à l'ouverture — sans ce stub, l'ouverture du
// menu lève une `TypeError` avant même que les options ne soient accessibles.
beforeAll(() => {
  Element.prototype.scrollIntoView = vi.fn();
});

function renderSelect(onChange = vi.fn()) {
  render(<JobSortSelect value="recent" onChange={onChange} />);
  return onChange;
}

describe('JobSortSelect', () => {
  it('affiche chaque libelle de tri une seule fois, tous actifs (score, tranche 4)', async () => {
    const user = userEvent.setup();
    renderSelect();

    await user.click(screen.getByRole('combobox'));

    // Limite la recherche au menu ouvert (`listbox`) : le déclencheur reprend lui-même le
    // libellé de la valeur sélectionnée (`SelectValue`), ce qui compterait sinon une
    // seconde occurrence légitime de « Plus récentes » sans rapport avec une duplication.
    const listbox = within(screen.getByRole('listbox'));
    for (const option of JOB_SORT_OPTIONS) {
      expect(listbox.getAllByText(option.label)).toHaveLength(1);
      expect(screen.getByRole('option', { name: option.label })).not.toHaveAttribute('data-disabled');
    }
  });

  it('declenche onChange en choisissant Salaire', async () => {
    const user = userEvent.setup();
    const onChange = renderSelect();

    await user.click(screen.getByRole('combobox'));
    await user.click(screen.getByRole('option', { name: 'Salaire' }));

    expect(onChange).toHaveBeenCalledWith('salary');
  });

  it('declenche onChange("match") en choisissant Meilleur match', async () => {
    const user = userEvent.setup();
    const onChange = renderSelect();

    await user.click(screen.getByRole('combobox'));
    await user.click(screen.getByRole('option', { name: 'Meilleur match' }));

    expect(onChange).toHaveBeenCalledWith('match');
  });

  it('declenche onChange("relevance") en choisissant Pertinence', async () => {
    const user = userEvent.setup();
    const onChange = renderSelect();

    await user.click(screen.getByRole('combobox'));
    await user.click(screen.getByRole('option', { name: 'Pertinence' }));

    expect(onChange).toHaveBeenCalledWith('relevance');
  });
});
