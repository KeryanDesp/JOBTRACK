import type { CoverLetterTone } from '@jobtrack/shared';
import { COVER_LETTER_MAX_CHARS, COVER_LETTER_TONES, COVER_LETTER_TONE_LABELS } from '@jobtrack/shared';
import { Label } from '@/components/ui/label';
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group';
import { cn } from '@/lib/utils';

export interface TonePickerProps {
  value: CoverLetterTone;
  onChange: (tone: CoverLetterTone) => void;
  disabled?: boolean;
  className?: string;
}

// Radix ne typant `onValueChange` qu'en `string` : `COVER_LETTER_TONES` (contrat
// partagé) sert de garde d'exécution réelle, même principe que `TemplatePicker`
// (`isResumeTemplate`) pour le modèle de CV.
function isCoverLetterTone(value: string): value is CoverLetterTone {
  return (COVER_LETTER_TONES as readonly string[]).includes(value);
}

/**
 * Choix du ton de la lettre de motivation (spec §2/§4/§7, tâche 8) : trois
 * cartes cliquables, chacune avec son libellé et le nombre maximal de
 * caractères que l'IA ancrera pour ce ton (spec §5, `COVER_LETTER_MAX_CHARS`)
 * — l'utilisateur sait avant de générer à quoi s'attendre.
 */
export function TonePicker({ value, onChange, disabled, className }: TonePickerProps) {
  return (
    <RadioGroup
      value={value}
      onValueChange={(next) => {
        if (isCoverLetterTone(next)) onChange(next);
      }}
      disabled={disabled}
      className={cn('grid gap-3 sm:grid-cols-3', className)}
      aria-label="Ton de la lettre"
    >
      {COVER_LETTER_TONES.map((tone) => (
        <Label
          key={tone}
          htmlFor={`cover-letter-tone-${tone}`}
          className={cn(
            'flex cursor-pointer flex-col gap-1 rounded-md border p-3 text-sm font-medium transition-colors hover:bg-accent',
            value === tone && 'border-primary bg-accent',
            disabled && 'cursor-not-allowed opacity-50',
          )}
        >
          <span className="flex items-center gap-2">
            <RadioGroupItem id={`cover-letter-tone-${tone}`} value={tone} />
            {COVER_LETTER_TONE_LABELS[tone]}
          </span>
          <span className="text-muted-foreground pl-6 text-xs font-normal">≤ {COVER_LETTER_MAX_CHARS[tone]} caractères</span>
        </Label>
      ))}
    </RadioGroup>
  );
}
