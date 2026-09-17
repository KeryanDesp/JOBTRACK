import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { MatchBadge } from './match-badge';

describe('MatchBadge', () => {
  it('affiche le score et un aria-label indiquant la correspondance sur 100', () => {
    render(<MatchBadge score={92} band="EXCELLENT" />);

    expect(screen.getByText('92')).toBeInTheDocument();
    expect(screen.getByText('Match')).toBeInTheDocument();
    expect(screen.getByRole('img', { name: 'Correspondance 92 sur 100' })).toBeInTheDocument();
  });

  it('applique une teinte differente selon la bande', () => {
    const { container: excellent } = render(<MatchBadge score={90} band="EXCELLENT" />);
    const { container: partial } = render(<MatchBadge score={55} band="PARTIAL" />);

    expect(excellent.querySelector('[role="img"]')?.className).toContain('text-success');
    expect(partial.querySelector('[role="img"]')?.className).toContain('text-warning');
  });

  it('affiche un tiret et un aria-label non evalue quand le score est nul', () => {
    render(<MatchBadge score={null} band={null} />);

    expect(screen.getByText('—')).toBeInTheDocument();
    expect(screen.getByRole('img', { name: 'Correspondance non évaluée' })).toBeInTheDocument();
  });
});
