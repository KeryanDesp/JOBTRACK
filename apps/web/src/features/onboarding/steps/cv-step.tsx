import type { CvImportDto } from '@jobtrack/shared';
import { CvUploadFlow } from '@/features/cv-import/components/cv-upload-flow';

interface CvStepProps {
  /** Brouillon extrait avec succès : l'appelant range l'identifiant et passe à la vérification. */
  onExtracted: (importId: string) => void;
  /** L'IA n'est pas disponible, ou l'utilisateur préfère saisir son profil lui-même. */
  onManual: () => void;
}

/**
 * Étape « Importer un CV » de l'accueil : fine pellicule au-dessus de
 * `CvUploadFlow` (partagée avec la page d'import direct du profil), qui ne
 * connaît que l'identifiant du brouillon — pas le `CvImportDto` complet, que
 * cette étape n'a jamais eu besoin d'exposer à `OnboardingPage`.
 */
export function CvStep({ onExtracted, onManual }: CvStepProps) {
  return <CvUploadFlow onExtracted={(dto: CvImportDto) => onExtracted(dto.id)} onManual={onManual} />;
}
