import { useEffect, type ReactNode } from 'react';
import { applyTheme } from '@/lib/theme';
import { useThemeStore } from '@/stores/theme-store';

export function ThemeProvider({ children }: { children: ReactNode }) {
  const mode = useThemeStore((state) => state.mode);

  useEffect(() => {
    applyTheme(mode);

    // En mode système, suivre les changements de préférence en direct.
    if (mode !== 'system') return;

    const media = window.matchMedia('(prefers-color-scheme: dark)');
    const onChange = () => applyTheme('system');
    media.addEventListener('change', onChange);
    return () => media.removeEventListener('change', onChange);
  }, [mode]);

  return <>{children}</>;
}
