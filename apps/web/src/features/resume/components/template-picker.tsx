import type { ResumeTemplate } from '@jobtrack/shared';
import { RESUME_TEMPLATES } from '@jobtrack/shared';
import { Label } from '@/components/ui/label';
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group';
import { cn } from '@/lib/utils';
import { RESUME_TEMPLATE_OPTIONS } from '../lib/templates';

export interface TemplatePickerProps {
  value: ResumeTemplate;
  onChange: (template: ResumeTemplate) => void;
  disabled?: boolean;
  className?: string;
}

// Radix ne typant `onValueChange` qu'en `string` (n'importe quelle valeur
// portée par un `value` de `RadioGroupItem`), une simple assertion `as
// ResumeTemplate` accepterait sans vérification une valeur qui ne serait pas
// l'un des deux modèles. `RESUME_TEMPLATES` (contrat partagé) sert ici de
// garde d'exécution réelle : la conversion en `readonly string[]` élargit
// juste le type du tableau, elle n'affirme rien sur `next`.
function isResumeTemplate(value: string): value is ResumeTemplate {
  return (RESUME_TEMPLATES as readonly string[]).includes(value);
}

/**
 * Sélecteur de modèle (spec §2/§7 : « sélecteur de modèle, Classique / Moderne,
 * mémorisé ») : deux cartes cliquables plutôt qu'une liste déroulante — le
 * choix reste toujours visible, et chaque option porte son libellé.
 */
export function TemplatePicker({ value, onChange, disabled, className }: TemplatePickerProps) {
  return (
    <RadioGroup
      value={value}
      onValueChange={(next) => {
        if (isResumeTemplate(next)) onChange(next);
      }}
      disabled={disabled}
      className={cn('grid grid-cols-1 gap-3 sm:grid-cols-2', className)}
      aria-label="Modèle de CV"
    >
      {RESUME_TEMPLATE_OPTIONS.map((option) => (
        <Label
          key={option.value}
          htmlFor={`resume-template-${option.value}`}
          className={cn(
            'flex cursor-pointer items-center gap-2 rounded-md border p-3 text-sm font-medium transition-colors hover:bg-accent',
            value === option.value && 'border-primary bg-accent',
            disabled && 'cursor-not-allowed opacity-50',
          )}
        >
          <RadioGroupItem id={`resume-template-${option.value}`} value={option.value} />
          {option.label}
        </Label>
      ))}
    </RadioGroup>
  );
}
