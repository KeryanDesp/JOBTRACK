import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { describe, expect, it } from 'vitest';
import { IncompleteProfileNotice } from './incomplete-profile-notice';

describe('IncompleteProfileNotice', () => {
  it('affiche le message et les liens vers le profil et l_import de CV', () => {
    render(
      <MemoryRouter>
        <IncompleteProfileNotice />
      </MemoryRouter>,
    );

    expect(screen.getByText('Complétez vos compétences et expériences pour obtenir un score fiable.')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Compléter mon profil' })).toHaveAttribute('href', '/profile');
    expect(screen.getByRole('link', { name: 'Importer mon CV' })).toHaveAttribute('href', '/profile/import');
  });
});
