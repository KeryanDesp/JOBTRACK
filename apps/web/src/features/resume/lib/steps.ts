import { useSearchParams } from 'react-router-dom';

/**
 * Étapes de la génération d'un CV adapté (spec §2/§7, tâche 7), dans l'URL
 * (`/resume/create/:jobId?etape=<clé>`) : source unique pour la page et
 * `StepHeader`, comme `ONBOARDING_STEPS` (`features/onboarding/lib/steps.ts`).
 */
export const RESUME_STEPS = ['analyse', 'selection', 'apercu', 'pdf'] as const;

export type ResumeCreateStep = (typeof RESUME_STEPS)[number];

export const RESUME_STEP_LABELS: Record<ResumeCreateStep, string> = {
  analyse: "Analyse de l'offre",
  selection: 'Sélection du contenu',
  apercu: 'Aperçu',
  pdf: 'PDF',
};

export function isResumeCreateStep(value: string): value is ResumeCreateStep {
  return RESUME_STEPS.includes(value as ResumeCreateStep);
}

const DEFAULT_STEP: ResumeCreateStep = RESUME_STEPS[0];

/**
 * Étape courante pilotée par le paramètre de requête `?etape=` (spec tâche 7) :
 * une valeur absente ou inconnue retombe sur la première étape plutôt que
 * d'afficher un écran vide. `goToStep` remplace l'entrée d'historique
 * (`replace`) : naviguer entre les étapes d'une même génération ne doit pas
 * empiler des entrées « Précédent » distinctes dans l'historique du navigateur.
 */
export function useResumeStep(): { step: ResumeCreateStep; goToStep: (next: ResumeCreateStep) => void } {
  const [searchParams, setSearchParams] = useSearchParams();
  const raw = searchParams.get('etape') ?? DEFAULT_STEP;
  const step: ResumeCreateStep = isResumeCreateStep(raw) ? raw : DEFAULT_STEP;

  function goToStep(next: ResumeCreateStep): void {
    setSearchParams(
      (previous) => {
        const params = new URLSearchParams(previous);
        params.set('etape', next);
        return params;
      },
      { replace: true },
    );
  }

  return { step, goToStep };
}
