import type { CvApplyResult } from '@jobtrack/shared';
import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Button } from '@/components/ui/button';
import { useCompleteOnboarding } from '@/features/cv-import/hooks/use-cv-import';
import { clearOnboardingImportId, clearOnboardingResult, getOnboardingResult } from '../lib/storage';

const CREATED_LABELS: Record<keyof CvApplyResult['created'], string> = {
  experiences: 'expérience',
  educations: 'formation',
  skills: 'compétence',
  languages: 'langue',
  certifications: 'certification',
  projects: 'projet',
};

function pluralize(count: number, singular: string): string {
  return `${count} ${singular}${count === 1 ? '' : 's'}`;
}

function buildRecap(result: CvApplyResult): string {
  const parts = Object.entries(result.created)
    .filter(([, count]) => count > 0)
    .map(([key, count]) => pluralize(count, CREATED_LABELS[key as keyof CvApplyResult['created']]));
  return parts.length > 0 ? `Ajoutés à votre profil : ${parts.join(', ')}.` : 'Votre profil est prêt.';
}

/**
 * Dernière étape de l'accueil : pose `onboardingCompletedAt` dès l'arrivée
 * (pas seulement au clic sur « Voir mon profil » — un abandon sur cette
 * étape ne doit pas laisser l'accueil inachevé), puis efface les deux clés
 * de session propres à l'accueil (import en cours, récapitulatif).
 */
export function DoneStep() {
  const navigate = useNavigate();
  const completeOnboarding = useCompleteOnboarding();
  const [result] = useState<CvApplyResult | null>(() => getOnboardingResult());

  useEffect(() => {
    completeOnboarding.mutate();
    clearOnboardingImportId();
    clearOnboardingResult();
    // `completeOnboarding.mutate` : référence stable de `useMutation` (React Query) — cet
    // effet ne doit s'exécuter qu'au montage de l'étape, jamais se répéter.
  }, [completeOnboarding.mutate]);

  return (
    <div className="space-y-6 text-center">
      <h2 className="text-xl font-semibold tracking-tight">C'est prêt</h2>
      <p className="text-muted-foreground text-sm">
        {result ? buildRecap(result) : 'Votre profil est prêt. Vous pourrez toujours importer votre CV depuis votre profil.'}
      </p>
      <Button
        onClick={() => completeOnboarding.mutate(undefined, { onSuccess: () => navigate('/profile') })}
        disabled={completeOnboarding.isPending}
      >
        Voir mon profil
      </Button>
    </div>
  );
}
