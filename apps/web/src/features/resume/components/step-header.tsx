import { ArrowRight, Check } from 'lucide-react';
import { cn } from '@/lib/utils';
import { RESUME_STEP_LABELS, RESUME_STEPS, type ResumeCreateStep } from '../lib/steps';

interface StepHeaderProps {
  current: ResumeCreateStep;
}

/** Bandeau en trois colonnes (spec §2 : « Votre CV actuel → Analyse de l'offre → CV adapté »). */
const BANNER_COLUMNS = ['Votre CV actuel', "Analyse de l'offre", 'CV adapté'] as const;

/**
 * En-tête de la génération d'un CV adapté (spec §2/§7, tâche 7) : bandeau en
 * trois colonnes puis indicateur des quatre étapes, même principe que
 * `StepIndicator` (`features/onboarding/components/step-indicator.tsx`) —
 * `aria-current="step"` sur l'élément de liste de l'étape courante, mention
 * `sr-only` « Étape N sur 4 », le reste (numéro/coche, couleurs) décoratif.
 */
export function StepHeader({ current }: StepHeaderProps) {
  const currentIndex = RESUME_STEPS.indexOf(current);
  const total = RESUME_STEPS.length;

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-3 items-center gap-2 rounded-lg border bg-muted/40 p-3 text-center text-sm font-medium text-muted-foreground">
        {BANNER_COLUMNS.map((label, index) => (
          <div key={label} className="flex items-center justify-center gap-1.5">
            {index > 0 && <ArrowRight className="size-4 shrink-0" aria-hidden="true" />}
            <span>{label}</span>
          </div>
        ))}
      </div>

      <ol aria-label="Étapes de génération du CV" className="flex items-start justify-between gap-1">
        {RESUME_STEPS.map((step, index) => {
          const isDone = index < currentIndex;
          const isCurrent = step === current;

          return (
            <li
              key={step}
              aria-current={isCurrent ? 'step' : undefined}
              className="flex flex-1 flex-col items-center gap-1.5 text-center"
            >
              {isCurrent && <span className="sr-only">{`Étape ${index + 1} sur ${total}`}</span>}
              <span
                className={cn(
                  'flex size-7 items-center justify-center rounded-full border text-xs font-medium transition-colors',
                  isDone && 'border-primary bg-primary text-primary-foreground',
                  isCurrent && 'border-primary text-primary',
                  !isDone && !isCurrent && 'border-muted-foreground/30 text-muted-foreground',
                )}
              >
                {isDone ? <Check className="size-3.5" aria-hidden="true" /> : index + 1}
              </span>
              <span className={cn('text-xs', isCurrent ? 'text-foreground font-medium' : 'text-muted-foreground')}>
                {RESUME_STEP_LABELS[step]}
              </span>
            </li>
          );
        })}
      </ol>
    </div>
  );
}
