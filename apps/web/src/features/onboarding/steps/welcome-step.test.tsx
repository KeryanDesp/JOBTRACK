import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { WelcomeStep } from './welcome-step';

describe('WelcomeStep', () => {
  it('affiche le prenom de l_utilisateur et declenche onNext au clic sur commencer', async () => {
    const user = userEvent.setup();
    const onNext = vi.fn();
    render(<WelcomeStep firstName="Ada" onNext={onNext} />);

    expect(screen.getByText('Bienvenue, Ada')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Commencer' }));
    expect(onNext).toHaveBeenCalledTimes(1);
  });
});
