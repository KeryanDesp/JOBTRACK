import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ThemeProvider } from '@/app/providers/theme-provider';
import { THEME_STORAGE_KEY } from '@/lib/theme';
import { useThemeStore } from '@/stores/theme-store';
import { ThemeToggle } from './theme-toggle';

describe('ThemeToggle', () => {
  beforeEach(() => {
    localStorage.clear();
    document.documentElement.classList.remove('dark');
    useThemeStore.setState({ mode: 'light' });
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
    render(
      <ThemeProvider>
        <ThemeToggle />
      </ThemeProvider>,
    );

    await user.click(screen.getByRole('button', { name: /thème/i }));

    expect(screen.getByRole('menuitemradio', { name: 'Clair' })).toBeInTheDocument();
    expect(screen.getByRole('menuitemradio', { name: 'Sombre' })).toBeInTheDocument();
    expect(screen.getByRole('menuitemradio', { name: 'Système' })).toBeInTheDocument();
    expect(screen.getByRole('menuitemradio', { name: 'Clair' })).toHaveAttribute(
      'aria-checked',
      'true',
    );

    await user.click(screen.getByRole('menuitemradio', { name: 'Sombre' }));

    expect(document.documentElement.classList.contains('dark')).toBe(true);
    expect(localStorage.getItem(THEME_STORAGE_KEY)).toBe('dark');

    await user.click(screen.getByRole('button', { name: /thème/i }));
    expect(screen.getByRole('menuitemradio', { name: 'Sombre' })).toHaveAttribute(
      'aria-checked',
      'true',
    );
  });
});
