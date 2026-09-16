import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it } from 'vitest';
import { useThemeStore } from '@/stores/theme-store';
import { AppearanceCard } from './appearance-card';

beforeEach(() => {
  useThemeStore.setState({ mode: 'light' });
});

describe('AppearanceCard', () => {
  it('selectionne le theme sombre au clic sur « Sombre »', async () => {
    const user = userEvent.setup();
    render(<AppearanceCard />);

    await user.click(screen.getByRole('radio', { name: 'Sombre' }));

    expect(useThemeStore.getState().mode).toBe('dark');
  });
});
