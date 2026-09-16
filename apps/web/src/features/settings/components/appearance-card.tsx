import { useRef, type KeyboardEvent } from 'react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { THEME_OPTIONS } from '@/lib/theme';
import { cn } from '@/lib/utils';
import { useThemeStore } from '@/stores/theme-store';

export function AppearanceCard() {
  const mode = useThemeStore((state) => state.mode);
  const setMode = useThemeStore((state) => state.setMode);
  const buttonRefs = useRef<Array<HTMLButtonElement | null>>([]);

  // Tabindex baladeur (WAI-ARIA radiogroup) : une seule des trois options est dans
  // l'ordre de tabulation (celle sélectionnée) ; les flèches déplacent à la fois la
  // sélection et le focus entre les deux autres, en bouclant aux extrémités.
  function moveSelection(delta: number): void {
    const currentIndex = THEME_OPTIONS.findIndex((option) => option.mode === mode);
    const nextIndex = (currentIndex + delta + THEME_OPTIONS.length) % THEME_OPTIONS.length;
    const next = THEME_OPTIONS[nextIndex];
    if (!next) return;
    setMode(next.mode);
    buttonRefs.current[nextIndex]?.focus();
  }

  function onKeyDown(event: KeyboardEvent<HTMLDivElement>): void {
    if (event.key === 'ArrowRight' || event.key === 'ArrowDown') {
      event.preventDefault();
      moveSelection(1);
    } else if (event.key === 'ArrowLeft' || event.key === 'ArrowUp') {
      event.preventDefault();
      moveSelection(-1);
    }
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>Apparence</CardTitle>
        <CardDescription>Choisissez comment JobTrack s'affiche sur cet appareil.</CardDescription>
      </CardHeader>
      <CardContent>
        <div
          role="radiogroup"
          aria-label="Thème"
          className="grid grid-cols-1 gap-3 sm:grid-cols-3"
          onKeyDown={onKeyDown}
        >
          {THEME_OPTIONS.map(({ mode: value, label, Icon }, index) => {
            const checked = mode === value;
            return (
              <button
                key={value}
                ref={(node) => {
                  buttonRefs.current[index] = node;
                }}
                type="button"
                role="radio"
                aria-checked={checked}
                tabIndex={checked ? 0 : -1}
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
