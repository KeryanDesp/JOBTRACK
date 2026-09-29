import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { BreakdownList } from './breakdown-list';

describe('BreakdownList', () => {
  it('affiche chaque ligne avec son compte', () => {
    render(
      <BreakdownList
        rows={[
          { key: 'LINKEDIN', label: 'LinkedIn', count: 4 },
          { key: 'INDEED', label: 'Indeed', count: 1 },
        ]}
        emptyLabel="Rien à afficher."
      />,
    );

    expect(screen.getByText('LinkedIn')).toBeInTheDocument();
    expect(screen.getByText('4')).toBeInTheDocument();
    expect(screen.getByText('Indeed')).toBeInTheDocument();
  });

  it('cale les barres sur la ligne la plus haute, pas sur le total', () => {
    const { container } = render(
      <BreakdownList
        rows={[
          { key: 'a', label: 'Alpha', count: 8 },
          { key: 'b', label: 'Beta', count: 2 },
        ]}
        emptyLabel="Rien à afficher."
      />,
    );

    const widths = [...container.querySelectorAll<HTMLElement>('.bg-primary\\/70')].map((bar) => bar.style.width);
    expect(widths).toEqual(['100%', '25%']);
  });

  it('affiche la phrase de repli quand il n_y a aucune ligne', () => {
    render(<BreakdownList rows={[]} emptyLabel="Aucune source enregistrée." />);

    expect(screen.getByText('Aucune source enregistrée.')).toBeInTheDocument();
  });
});
