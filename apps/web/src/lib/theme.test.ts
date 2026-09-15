import { beforeEach, describe, expect, it, vi } from 'vitest';
import { applyTheme, readStoredTheme, resolveTheme, THEME_STORAGE_KEY } from './theme';

function mockPrefersDark(prefersDark: boolean): void {
  vi.stubGlobal(
    'matchMedia',
    vi.fn().mockReturnValue({
      matches: prefersDark,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
    }),
  );
}

describe('theme', () => {
  beforeEach(() => {
    localStorage.clear();
    document.documentElement.classList.remove('dark');
  });

  it('retombe sur le thème clair quand rien n_est stocké', () => {
    expect(readStoredTheme()).toBe('light');
  });

  it('retombe sur le thème clair quand la valeur stockée est invalide', () => {
    localStorage.setItem(THEME_STORAGE_KEY, 'bleu-canard');
    expect(readStoredTheme()).toBe('light');
  });

  it('relit une valeur stockée valide', () => {
    localStorage.setItem(THEME_STORAGE_KEY, 'dark');
    expect(readStoredTheme()).toBe('dark');
  });

  it('résout le mode système selon la préférence du navigateur', () => {
    mockPrefersDark(true);
    expect(resolveTheme('system')).toBe('dark');
    mockPrefersDark(false);
    expect(resolveTheme('system')).toBe('light');
  });

  it('ne consulte pas le navigateur pour un mode explicite', () => {
    mockPrefersDark(true);
    expect(resolveTheme('light')).toBe('light');
  });

  it('ajoute et retire la classe dark sur la racine du document', () => {
    mockPrefersDark(false);
    applyTheme('dark');
    expect(document.documentElement.classList.contains('dark')).toBe(true);
    applyTheme('light');
    expect(document.documentElement.classList.contains('dark')).toBe(false);
  });
});
