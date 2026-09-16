import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { StepIndicator } from './step-indicator';

describe('StepIndicator', () => {
  it('marque l_etape courante et affiche une coche pour les etapes terminees', () => {
    render(<StepIndicator current="preferences" />);

    const current = screen.getByText('Préférences').closest('li');
    expect(current).toHaveAttribute('aria-current', 'step');
    expect(screen.getByText('Étape 4 sur 5')).toBeInTheDocument();

    const done = screen.getByText('CV').closest('li');
    expect(done?.querySelector('svg')).not.toBeNull();
    expect(done).not.toHaveAttribute('aria-current');

    const upcoming = screen.getByText('Terminé').closest('li');
    expect(upcoming?.querySelector('svg')).toBeNull();
    expect(upcoming).not.toHaveAttribute('aria-current');
  });
});
