import { Toaster } from '@/components/ui/sonner';
import { useThemeStore } from '@/stores/theme-store';

/**
 * Monte le Toaster de sonner en lui transmettant le mode du store applicatif.
 * `ThemeMode` et `ToasterProps['theme']` partagent exactement les mêmes valeurs
 * (`light` | `dark` | `system`) : sonner résout lui-même le mode système.
 */
export function AppToaster() {
  const mode = useThemeStore((state) => state.mode);
  return <Toaster theme={mode} position="bottom-right" />;
}
