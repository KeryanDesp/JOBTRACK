import type { CvImportDto } from '@jobtrack/shared';
import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { PageHeader } from '@/components/shared/page-header';
import { CvImportReview } from '@/features/cv-import/components/cv-import-review';
import { CvUploadFlow } from '@/features/cv-import/components/cv-upload-flow';
import { useDeleteCvImport } from '@/features/cv-import/hooks/use-cv-import';

type Phase = { step: 'upload' } | { step: 'review'; importId: string };

/**
 * Import d'un CV depuis le profil (`/profile/import`) : rejoue les étapes
 * « Importer un CV » et « Vérifier » de l'accueil, sans le reste du parcours
 * (préférences, page « Terminé »). Réutilise `CvUploadFlow` et
 * `CvImportReview` — les deux mêmes composants que l'accueil — plutôt que de
 * dupliquer la machine d'état de l'envoi ou celle de la revue.
 */
export function ImportCvPage() {
  const navigate = useNavigate();
  const deleteCvImport = useDeleteCvImport();
  const [phase, setPhase] = useState<Phase>({ step: 'upload' });

  function handleExtracted(dto: CvImportDto): void {
    setPhase({ step: 'review', importId: dto.id });
  }

  function handleBack(): void {
    // Au mieux : une panne réseau sur cette suppression ne doit jamais empêcher de
    // revenir au dépôt (voir le même choix dans `onboarding/pages/onboarding-page.tsx`).
    if (phase.step === 'review') deleteCvImport.mutate(phase.importId);
    setPhase({ step: 'upload' });
  }

  return (
    <div className="mx-auto max-w-2xl">
      <PageHeader
        title="Importer un CV"
        description="Déposez votre CV, vérifiez les informations extraites, puis appliquez-les à votre profil."
      />
      {phase.step === 'upload' && <CvUploadFlow onExtracted={handleExtracted} />}
      {phase.step === 'review' && (
        <CvImportReview importId={phase.importId} onApplied={() => navigate('/profile')} onBack={handleBack} />
      )}
    </div>
  );
}
