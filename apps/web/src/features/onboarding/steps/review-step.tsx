import type { CvApplyResult } from '@jobtrack/shared';
import { CvImportReview } from '@/features/cv-import/components/cv-import-review';

export interface ReviewStepProps {
  importId: string;
  onApplied: (result: CvApplyResult) => void;
  onBack: () => void;
}

/**
 * Étape « Vérifier » de l'accueil : fine pellicule au-dessus de
 * `CvImportReview` (partagée avec l'import direct depuis le profil), qui
 * porte la revue bloc par bloc, le chargement/sondage du brouillon et son
 * application. `OnboardingPage` n'a rien eu à changer une fois ce contenu
 * livré (voir `handleExtracted`/`handleReviewBack`) : le contrat de props
 * (`ReviewStepProps`) est celui déjà en place depuis la tâche 7.
 */
export function ReviewStep({ importId, onApplied, onBack }: ReviewStepProps) {
  return <CvImportReview importId={importId} onApplied={onApplied} onBack={onBack} />;
}
