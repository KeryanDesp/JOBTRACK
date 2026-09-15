import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { ErrorState } from './error-state';

describe('ErrorState', () => {
  it('affiche un message lisible et permet de réessayer', async () => {
    const onRetry = vi.fn();
    const user = userEvent.setup();

    render(<ErrorState message="Impossible de charger les offres." onRetry={onRetry} />);

    expect(screen.getByText('Impossible de charger les offres.')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Réessayer' }));
    expect(onRetry).toHaveBeenCalledOnce();
  });

  it('n_affiche jamais de code HTTP brut', () => {
    render(<ErrorState message="Impossible de charger les offres." onRetry={vi.fn()} />);
    expect(screen.queryByText(/500|Error \d+/)).not.toBeInTheDocument();
  });
});
