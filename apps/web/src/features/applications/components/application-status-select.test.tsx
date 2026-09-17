import { APPLICATION_STATUS_LABELS } from '@jobtrack/shared';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeAll, describe, expect, it, vi } from 'vitest';
import { ApplicationStatusSelect } from './application-status-select';

// Radix Select fait defiler l'option active en vue a l'ouverture : jsdom ne
// l'implemente pas.
beforeAll(() => {
  Element.prototype.scrollIntoView = vi.fn();
});

describe('ApplicationStatusSelect', () => {
  it('affiche le libelle du statut courant et l_intitule accessible demande', () => {
    render(<ApplicationStatusSelect value="INTERVIEW" onChange={vi.fn()} ariaLabel="Statut de Data Analyst" />);

    const trigger = screen.getByRole('combobox', { name: 'Statut de Data Analyst' });
    expect(trigger).toHaveTextContent(APPLICATION_STATUS_LABELS.INTERVIEW);
  });

  it('declenche onChange avec le statut choisi', async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    render(<ApplicationStatusSelect value="TO_APPLY" onChange={onChange} ariaLabel="Statut de Data Analyst" />);

    await user.click(screen.getByRole('combobox', { name: 'Statut de Data Analyst' }));
    await user.click(await screen.findByRole('option', { name: APPLICATION_STATUS_LABELS.OFFER }));

    expect(onChange).toHaveBeenCalledWith('OFFER');
  });

  it('reste inerte quand il est desactive', () => {
    render(<ApplicationStatusSelect value="APPLIED" onChange={vi.fn()} disabled ariaLabel="Statut de Data Analyst" />);

    expect(screen.getByRole('combobox', { name: 'Statut de Data Analyst' })).toBeDisabled();
  });
});
