import { cn } from '@/lib/utils';

interface AnalysisProgressProps {
  /** Nombre d'offres encore en cours d'analyse. `0`/négatif : rien n'est affiché. */
  count: number;
  className?: string;
}

/**
 * Bandeau discret « Analyse de N offres… » (spec §2), affiché sous le
 * sous-titre de la liste pendant `useAnalyzeJobs`/`useAnalysisPolling`.
 * `role="status" aria-live="polite"` : annoncé au lecteur d'écran sans
 * interrompre sa lecture en cours (pas une alerte bloquante).
 */
export function AnalysisProgress({ count, className }: AnalysisProgressProps) {
  if (count <= 0) return null;

  return (
    <div role="status" aria-live="polite" className={cn('flex items-center gap-2 text-xs text-muted-foreground', className)}>
      <span>
        Analyse de {count} offre{count > 1 ? 's' : ''}…
      </span>
      <span className="relative h-1 w-20 overflow-hidden rounded-full bg-primary/20" aria-hidden="true">
        <span className="absolute inset-y-0 left-0 w-1/3 animate-pulse rounded-full bg-primary" />
      </span>
    </div>
  );
}
