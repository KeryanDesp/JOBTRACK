import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';
import { MatchExplanation } from './match-explanation';

describe('MatchExplanation', () => {
  it('bascule aria-expanded et affiche les lignes au clic sur Pourquoi ?', async () => {
    const user = userEvent.setup();
    render(
      <MatchExplanation
        explanation={{ top: ['React correspond', 'Metz : à 12 km'], weak: ['AWS non présent dans votre profil'] }}
      />,
    );

    const trigger = screen.getByRole('button', { name: 'Pourquoi ?' });
    expect(trigger).toHaveAttribute('aria-expanded', 'false');
    expect(screen.queryByText('React correspond')).not.toBeInTheDocument();

    await user.click(trigger);

    expect(trigger).toHaveAttribute('aria-expanded', 'true');
    expect(screen.getByText('React correspond')).toBeInTheDocument();
    expect(screen.getByText('AWS non présent dans votre profil')).toBeInTheDocument();

    await user.click(trigger);

    expect(trigger).toHaveAttribute('aria-expanded', 'false');
  });

  it('ne rend rien sans aucune ligne d_explication', () => {
    const { container } = render(<MatchExplanation explanation={{ top: [], weak: [] }} />);
    expect(container).toBeEmptyDOMElement();
  });
});
