import { create } from 'zustand';
import { applyTheme, readStoredTheme, storeTheme, type ThemeMode } from '@/lib/theme';

interface ThemeState {
  mode: ThemeMode;
  setMode: (mode: ThemeMode) => void;
}

export const useThemeStore = create<ThemeState>((set) => ({
  mode: readStoredTheme(),
  setMode: (mode) => {
    storeTheme(mode);
    applyTheme(mode);
    set({ mode });
  },
}));
