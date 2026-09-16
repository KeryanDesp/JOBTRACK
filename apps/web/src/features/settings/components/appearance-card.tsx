import { Monitor, Moon, Sun } from 'lucide-react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import type { ThemeMode } from '@/lib/theme';
import { cn } from '@/lib/utils';
import { useThemeStore } from '@/stores/theme-store';

const OPTIONS: ReadonlyArray<{ mode: ThemeMode; label: string; Icon: typeof Sun }> = [
  { mode: 'light', label: 'Clair', Icon: Sun },
  { mode: 'dark', label: 'Sombre', Icon: Moon },
  { mode: 'system', label: 'Système', Icon: Monitor },
];

export function AppearanceCard() {
  const mode = useThemeStore((state) => state.mode);
  const setMode = useThemeStore((state) => state.setMode);

  return (
    <Card>
      <CardHeader>
        <CardTitle>Apparence</CardTitle>
        <CardDescription>Choisissez comment JobTrack s'affiche sur cet appareil.</CardDescription>
      </CardHeader>
      <CardContent>
        <div role="radiogroup" aria-label="Thème" className="grid grid-cols-1 gap-3 sm:grid-cols-3">
          {OPTIONS.map(({ mode: value, label, Icon }) => {
            const checked = mode === value;
            return (
              <button
                key={value}
                type="button"
                role="radio"
                aria-checked={checked}
                onClick={() => setMode(value)}
                className={cn(
                  'flex flex-col items-center gap-2 rounded-lg border p-4 text-sm transition-colors',
                  checked
                    ? 'border-primary bg-accent text-foreground'
                    : 'text-muted-foreground hover:bg-accent/50',
                )}
              >
                <Icon className="size-5" />
                {label}
              </button>
            );
          })}
        </div>
      </CardContent>
    </Card>
  );
}
