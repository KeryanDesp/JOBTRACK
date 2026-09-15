import { render, waitFor } from '@testing-library/react';
import { toast } from 'sonner';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { useThemeStore } from '@/stores/theme-store';
import { AppToaster } from './app-toaster';

describe('AppToaster', () => {
  beforeEach(() => {
    vi.stubGlobal(
      'matchMedia',
      vi.fn().mockReturnValue({
        matches: false,
        addEventListener: vi.fn(),
        removeEventListener: vi.fn(),
      }),
    );
  });

  it('transmet le mode du store au Toaster', async () => {
    useThemeStore.setState({ mode: 'dark' });
    const { container } = render(<AppToaster />);

    // sonner ne rend son conteneur `[data-sonner-toaster]` que lorsqu'un toast
    // est affiché : on en déclenche un pour pouvoir observer l'attribut de thème.
    toast('Test');

    await waitFor(() => {
      expect(container.querySelector('[data-sonner-toaster]')).toHaveAttribute(
        'data-sonner-theme',
        'dark',
      );
    });
  });
});
