import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { describe, expect, it } from 'vitest';
import { NAV_ITEMS } from '@/constants/navigation';
import { AppSidebar } from './app-sidebar';

describe('AppSidebar', () => {
  it('affiche les neuf entrées de navigation du produit', () => {
    render(
      <MemoryRouter>
        <AppSidebar />
      </MemoryRouter>,
    );

    expect(NAV_ITEMS).toHaveLength(9);
    for (const item of NAV_ITEMS) {
      expect(screen.getByRole('link', { name: new RegExp(item.label, 'i') })).toBeInTheDocument();
    }
  });

  it('marque « Bientôt » les entrées dont la tranche n_est pas livrée', () => {
    render(
      <MemoryRouter>
        <AppSidebar />
      </MemoryRouter>,
    );

    const pending = NAV_ITEMS.filter((item) => !item.available);
    expect(screen.getAllByText('Bientôt')).toHaveLength(pending.length);
  });
});
