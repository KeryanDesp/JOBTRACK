import { create } from 'zustand';
import { readStoredTheme, storeTheme, type ThemeMode } from '@/lib/theme';

interface ThemeState {
  mode: ThemeMode;
  setMode: (mode: ThemeMode) => void;
}

// L'application effective du thème (classe `dark`, `color-scheme`) est laissée
// au seul `ThemeProvider`, qui réagit à tout changement de `mode` — y compris
// au montage. Le store ne fait que persister et notifier le nouveau mode.
export const useThemeStore = create<ThemeState>((set) => ({
  mode: readStoredTheme(),
  setMode: (mode) => {
    storeTheme(mode);
    set({ mode });
  },
}));
