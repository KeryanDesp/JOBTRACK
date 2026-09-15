import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { describe, expect, it } from 'vitest';
import { NAV_ITEMS } from '@/constants/navigation';
import { AppSidebar } from './app-sidebar';

describe('AppSidebar', () => {
  it('affiche chaque entrée de navigation du produit', () => {
    render(
      <MemoryRouter future={{ v7_startTransition: true, v7_relativeSplatPath: true }}>
        <AppSidebar />
      </MemoryRouter>,
    );

    for (const item of NAV_ITEMS) {
      expect(screen.getByRole('link', { name: new RegExp(item.label, 'i') })).toBeInTheDocument();
    }
  });

  it('marque « Bientôt » les entrées dont la tranche n_est pas livrée', () => {
    render(
      <MemoryRouter future={{ v7_startTransition: true, v7_relativeSplatPath: true }}>
        <AppSidebar />
      </MemoryRouter>,
    );

    const pending = NAV_ITEMS.filter((item) => !item.available);
    expect(screen.getAllByText('Bientôt')).toHaveLength(pending.length);
  });
});
