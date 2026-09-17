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

// Libellés des options désactivées (score, tranche 4) : dupliqués ici plutôt
// qu'importés depuis le composant, qui ne les exporte pas — le test doit
// rester capable de détecter une régression sur ces libellés eux-mêmes.
const DISABLED_LABELS = ['Meilleur match', 'Pertinence'];

function renderSelect(onChange = vi.fn()) {
  render(<JobSortSelect value="recent" onChange={onChange} />);
  return onChange;
}

describe('JobSortSelect', () => {
  it('affiche chaque libelle de tri une seule fois (actifs et desactives confondus)', async () => {
    const user = userEvent.setup();
    renderSelect();

    await user.click(screen.getByRole('combobox'));

    // Limite la recherche au menu ouvert (`listbox`) : le déclencheur reprend lui-même le
    // libellé de la valeur sélectionnée (`SelectValue`), ce qui compterait sinon une
    // seconde occurrence légitime de « Plus récentes » sans rapport avec une duplication.
    const listbox = within(screen.getByRole('listbox'));
    const labels = new Set([...JOB_SORT_OPTIONS.map((option) => option.label), ...DISABLED_LABELS]);
    for (const label of labels) {
      expect(listbox.getAllByText(label)).toHaveLength(1);
    }
  });

  it('propose Meilleur match avant Pertinence parmi les options desactivees', async () => {
    const user = userEvent.setup();
    renderSelect();

    await user.click(screen.getByRole('combobox'));

    const options = screen.getAllByRole('option').map((option) => option.textContent ?? '');
    const matchIndex = options.findIndex((text) => text.includes('Meilleur match'));
    const relevanceIndex = options.findIndex((text) => text.includes('Pertinence'));
    expect(matchIndex).toBeGreaterThanOrEqual(0);
    expect(relevanceIndex).toBeGreaterThan(matchIndex);
  });

  it('declenche onChange en choisissant une option active', async () => {
    const user = userEvent.setup();
    const onChange = renderSelect();

    await user.click(screen.getByRole('combobox'));
    await user.click(screen.getByRole('option', { name: 'Salaire' }));

    expect(onChange).toHaveBeenCalledWith('salary');
  });

  it('ne declenche jamais onChange sur une option desactivee (Meilleur match)', async () => {
    const user = userEvent.setup();
    const onChange = renderSelect();

    await user.click(screen.getByRole('combobox'));
    await user.click(screen.getByRole('option', { name: /Meilleur match/ }));

    expect(onChange).not.toHaveBeenCalled();
  });

  it('ne declenche jamais onChange sur une option desactivee (Pertinence)', async () => {
    const user = userEvent.setup();
    const onChange = renderSelect();

    await user.click(screen.getByRole('combobox'));
    await user.click(screen.getByRole('option', { name: /Pertinence/ }));

    expect(onChange).not.toHaveBeenCalled();
  });
});
