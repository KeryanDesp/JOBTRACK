import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { JobFilters } from './job-filters';

const EMPTY_VALUE: Parameters<typeof JobFilters>[0]['value'] = {
  contractTypes: [],
  remoteModes: [],
  experienceLevels: [],
  salaryMin: undefined,
  publishedWithinDays: undefined,
  sources: [],
};

describe('JobFilters', () => {
  it('garde le panneau mobile ouvert quand on choisit une option dans un multi-select imbrique', async () => {
    const user = userEvent.setup();
    render(<JobFilters value={EMPTY_VALUE} onChange={vi.fn()} />);

    await user.click(screen.getByRole('button', { name: /Filtres/ }));
    const sheet = await screen.findByRole('dialog');

    // Le popover « Contrat » de la rangée desktop existe aussi dans le DOM (masqué en CSS
    // seulement) : on cible explicitement celui du panneau mobile pour lever l'ambiguïté.
    await user.click(within(sheet).getByRole('button', { name: 'Contrat' }));
    // Le contenu du popover est rendu par portail (hors de l'arbre DOM du `Sheet`,
    // typiquement en enfant direct de `document.body`) : on le cherche donc dans tout
    // le document, pas via `within(sheet)`.
    const checkbox = await screen.findByRole('checkbox', { name: 'CDI' });
    await user.click(checkbox);

    // Sans `modal` sur le popover imbriqué, ce clic est vu comme un clic « à l'extérieur »
    // par le `Sheet`, qui se referme aussitôt.
    expect(screen.getByRole('dialog')).toBeInTheDocument();
    expect(checkbox).toBeChecked();
  });
});
