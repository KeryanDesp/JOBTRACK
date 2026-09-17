import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { PriorityChip } from './priority-chip';

describe('PriorityChip', () => {
  it('affiche le libelle francais de chaque priorite', () => {
    render(<PriorityChip priority="VERY_HIGH" />);
    expect(screen.getByText('Très forte priorité')).toBeInTheDocument();
  });

  it('affiche bonne opportunite pour la priorite GOOD', () => {
    render(<PriorityChip priority="GOOD" />);
    expect(screen.getByText('Bonne opportunité')).toBeInTheDocument();
  });

  it('ne rend rien sans priorite connue', () => {
    const { container } = render(<PriorityChip priority={null} />);
    expect(container).toBeEmptyDOMElement();
  });
});
