import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { describe, expect, it, vi } from 'vitest';
import { ResetPasswordPage } from './reset-password-page';

const resetPassword = vi.hoisted(() => vi.fn());
vi.mock('@/services/api/auth', () => ({ resetPassword, startGoogleLogin: vi.fn() }));

describe('ResetPasswordPage', () => {
  it('affiche une erreur quand le jeton manque', () => {
    render(
      <QueryClientProvider client={new QueryClient()}>
        <MemoryRouter initialEntries={['/reset-password']}>
          <ResetPasswordPage />
        </MemoryRouter>
      </QueryClientProvider>,
    );

    expect(screen.getByText('Ce lien est invalide ou a expiré.')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Demander un nouveau lien' })).toHaveAttribute(
      'href',
      '/forgot-password',
    );
    expect(resetPassword).not.toHaveBeenCalled();
  });
});
