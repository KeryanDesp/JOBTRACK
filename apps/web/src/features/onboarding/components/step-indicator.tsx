import { Check } from 'lucide-react';
import { cn } from '@/lib/utils';
import { ONBOARDING_STEPS, type OnboardingStep } from '../lib/steps';

interface StepIndicatorProps {
  current: OnboardingStep;
}

/**
 * Indicateur des cinq étapes de l'accueil : numéro (ou coche pour une étape
 * déjà passée), libellé, `aria-current="step"` sur l'étape courante — le seul
 * signal que l'API d'accessibilité doit porter, le reste (couleurs) n'étant
 * que décoratif.
 */
export function StepIndicator({ current }: StepIndicatorProps) {
  const currentIndex = ONBOARDING_STEPS.findIndex((step) => step.key === current);

  return (
    <ol aria-label="Étapes de configuration" className="flex items-start justify-between gap-1">
      {ONBOARDING_STEPS.map((step, index) => {
        const isDone = index < currentIndex;
        const isCurrent = index === currentIndex;

        return (
          <li key={step.key} className="flex flex-1 flex-col items-center gap-1.5 text-center">
            <span
              aria-current={isCurrent ? 'step' : undefined}
              className={cn(
                'flex size-7 items-center justify-center rounded-full border text-xs font-medium transition-colors',
                isDone && 'border-primary bg-primary text-primary-foreground',
                isCurrent && 'border-primary text-primary',
                !isDone && !isCurrent && 'border-muted-foreground/30 text-muted-foreground',
              )}
            >
              {isDone ? <Check className="size-3.5" aria-hidden /> : index + 1}
            </span>
            <span className={cn('text-xs', isCurrent ? 'text-foreground font-medium' : 'text-muted-foreground')}>
              {step.label}
            </span>
          </li>
        );
      })}
    </ol>
  );
}
