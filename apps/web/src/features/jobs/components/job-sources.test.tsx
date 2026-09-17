import type { JobSourceDto } from '@jobtrack/shared';
import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { JobSources } from './job-sources';

function makeSource(overrides: Partial<JobSourceDto> = {}): JobSourceDto {
  return {
    kind: 'FRANCE_TRAVAIL',
    externalId: '123',
    url: 'https://francetravail.fr/offres/123',
    applyUrl: null,
    partnerName: null,
    publishedAt: '2026-09-15T00:00:00.000Z',
    ...overrides,
  };
}

describe('JobSources', () => {
  it('ne rend rien sans aucune source', () => {
    const { container } = render(<JobSources sources={[]} />);
    expect(container).toBeEmptyDOMElement();
  });

  it('affiche une seule ligne sans mention de compte pour une source unique', () => {
    render(<JobSources sources={[makeSource()]} />);

    expect(screen.getByText('France Travail')).toBeInTheDocument();
    expect(screen.queryByText(/annonces\)/)).not.toBeInTheDocument();
    expect(screen.getAllByRole('link')).toHaveLength(1);
  });

  it('regroupe plusieurs annonces du meme type en une seule ligne avec le compte et un second lien', () => {
    render(
      <JobSources
        sources={[
          makeSource({ externalId: 'a', url: 'https://francetravail.fr/offres/a' }),
          makeSource({ externalId: 'b', url: 'https://francetravail.fr/offres/b' }),
        ]}
      />,
    );

    // Une seule ligne « France Travail », pas deux.
    expect(screen.getAllByText('France Travail')).toHaveLength(1);
    expect(screen.getByText('(2 annonces)')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: "Voir l'annonce sur France Travail" })).toHaveAttribute(
      'href',
      'https://francetravail.fr/offres/a',
    );
    expect(screen.getByRole('link', { name: 'Voir une autre annonce sur France Travail' })).toHaveAttribute(
      'href',
      'https://francetravail.fr/offres/b',
    );
    expect(screen.queryByText(/^et \d+ autres?$/)).not.toBeInTheDocument();
  });

  it('resume au-dela de deux annonces du meme type par « et n autre(s) »', () => {
    render(
      <JobSources
        sources={[
          makeSource({ externalId: 'a', url: 'https://francetravail.fr/offres/a' }),
          makeSource({ externalId: 'b', url: 'https://francetravail.fr/offres/b' }),
          makeSource({ externalId: 'c', url: 'https://francetravail.fr/offres/c' }),
        ]}
      />,
    );

    expect(screen.getByText('(3 annonces)')).toBeInTheDocument();
    expect(screen.getAllByRole('link')).toHaveLength(2);
    expect(screen.getByText('et 1 autre')).toBeInTheDocument();
  });
});
