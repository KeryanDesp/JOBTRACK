import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { TemplatePicker } from './template-picker';

describe('TemplatePicker', () => {
  it('affiche le modele actif comme coche', () => {
    render(<TemplatePicker value="CLASSIC" onChange={vi.fn()} />);

    expect(screen.getByRole('radio', { name: 'Classique' })).toHaveAttribute('data-state', 'checked');
    expect(screen.getByRole('radio', { name: 'Moderne' })).toHaveAttribute('data-state', 'unchecked');
  });

  it('appelle onChange avec le modele choisi au clic', async () => {
    const onChange = vi.fn();
    const user = userEvent.setup();
    render(<TemplatePicker value="CLASSIC" onChange={onChange} />);

    await user.click(screen.getByRole('radio', { name: 'Moderne' }));

    expect(onChange).toHaveBeenCalledWith('MODERN');
  });

  it('desactive les deux options quand disabled est vrai', () => {
    render(<TemplatePicker value="CLASSIC" onChange={vi.fn()} disabled />);

    expect(screen.getByRole('radio', { name: 'Classique' })).toBeDisabled();
    expect(screen.getByRole('radio', { name: 'Moderne' })).toBeDisabled();
  });
});
