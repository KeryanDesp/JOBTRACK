import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { AnalysisProgress } from './analysis-progress';

describe('AnalysisProgress', () => {
  it('affiche le nombre d_offres en cours d_analyse avec un statut annonce poliment', () => {
    render(<AnalysisProgress count={4} />);

    const status = screen.getByRole('status');
    expect(status).toHaveAttribute('aria-live', 'polite');
    expect(status).toHaveTextContent('Analyse de 4 offres…');
  });

  it('accorde offre au singulier pour une seule offre', () => {
    render(<AnalysisProgress count={1} />);
    expect(screen.getByRole('status')).toHaveTextContent('Analyse de 1 offre…');
  });

  it('ne rend rien quand aucune offre n_est en cours d_analyse', () => {
    const { container } = render(<AnalysisProgress count={0} />);
    expect(container).toBeEmptyDOMElement();
  });
});
