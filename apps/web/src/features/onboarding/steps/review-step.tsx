import type { CvApplyResult } from '@jobtrack/shared';
import { Button } from '@/components/ui/button';

export interface ReviewStepProps {
  importId: string;
  onApplied: (result: CvApplyResult) => void;
  onBack: () => void;
}

/** Résultat neutre : rien n'a réellement été appliqué par ce contenu provisoire. */
const EMPTY_APPLY_RESULT: CvApplyResult = {
  created: { experiences: 0, educations: 0, skills: 0, languages: 0, certifications: 0, projects: 0 },
};

/**
 * Emplacement de l'étape « Vérifier » : la revue bloc par bloc des données
 * extraites (tâche 8) n'est pas encore livrée. Le contrat de props
 * (`ReviewStepProps`) est déjà celui attendu par cette tâche, pour que
 * `OnboardingPage` n'ait rien à changer une fois le vrai contenu en place.
 */
export function ReviewStep({ onApplied, onBack }: ReviewStepProps) {
  return (
    <div className="space-y-6 text-center">
      <p className="text-muted-foreground text-sm">
        La vérification détaillée des données extraites arrive bientôt. Vous pouvez continuer vers vos
        préférences dès maintenant.
      </p>
      <div className="flex justify-center gap-2">
        <Button variant="outline" onClick={onBack}>
          Retour
        </Button>
        <Button onClick={() => onApplied(EMPTY_APPLY_RESULT)}>Continuer</Button>
      </div>
    </div>
  );
}
