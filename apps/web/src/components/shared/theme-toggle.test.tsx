import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { THEME_STORAGE_KEY } from '@/lib/theme';
import { ThemeToggle } from './theme-toggle';

describe('ThemeToggle', () => {
  beforeEach(() => {
    localStorage.clear();
    document.documentElement.classList.remove('dark');
    vi.stubGlobal(
      'matchMedia',
      vi.fn().mockReturnValue({
        matches: false,
        addEventListener: vi.fn(),
        removeEventListener: vi.fn(),
      }),
    );
  });

  it('propose les trois modes et applique le mode sombre', async () => {
    const user = userEvent.setup();
    render(<ThemeToggle />);

    await user.click(screen.getByRole('button', { name: /thème/i }));

    expect(screen.getByRole('menuitem', { name: 'Clair' })).toBeInTheDocument();
    expect(screen.getByRole('menuitem', { name: 'Sombre' })).toBeInTheDocument();
    expect(screen.getByRole('menuitem', { name: 'Système' })).toBeInTheDocument();

    await user.click(screen.getByRole('menuitem', { name: 'Sombre' }));

    expect(document.documentElement.classList.contains('dark')).toBe(true);
    expect(localStorage.getItem(THEME_STORAGE_KEY)).toBe('dark');
  });
});
