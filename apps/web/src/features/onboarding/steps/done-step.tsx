import type { CvApplyResult } from '@jobtrack/shared';
import { useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
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
 * étape ne doit pas laisser l'accueil inachevé). `hasStartedRef` empêche un
 * second `POST /onboarding/complete` si l'effet est rejoué (StrictMode en
 * développement) : `completeOnboarding.mutate` est une référence stable de
 * `useMutation`, mais on ne veut l'appeler qu'une seule fois par visite.
 *
 * « Voir mon profil » est un vrai lien (toujours navigable, y compris si la
 * requête de complétion échoue) plutôt qu'un bouton qui attendrait une
 * mutation : les deux clés de session propres à l'accueil ne sont donc
 * effacées qu'à ce clic (ou au démontage pour toute autre sortie), jamais au
 * montage — sinon un simple rechargement de cette étape perdrait le
 * récapitulatif.
 */
export function DoneStep() {
  const completeOnboarding = useCompleteOnboarding();
  const [result] = useState<CvApplyResult | null>(() => getOnboardingResult());
  const hasStartedRef = useRef(false);

  useEffect(() => {
    if (hasStartedRef.current) return;
    hasStartedRef.current = true;
    completeOnboarding.mutate();
  }, [completeOnboarding.mutate]);

  useEffect(() => {
    return () => {
      clearOnboardingImportId();
      clearOnboardingResult();
    };
  }, []);

  return (
    <div className="space-y-6 text-center">
      <h2 className="text-xl font-semibold tracking-tight">C'est prêt</h2>
      <p className="text-muted-foreground text-sm">
        {result ? buildRecap(result) : 'Votre profil est prêt. Vous pourrez toujours importer votre CV depuis votre profil.'}
      </p>
      <Button asChild>
        <Link to="/profile" onClick={() => { clearOnboardingImportId(); clearOnboardingResult(); }}>
          Voir mon profil
        </Link>
      </Button>
    </div>
  );
}
