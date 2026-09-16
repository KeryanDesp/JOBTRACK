import { useState } from 'react';
import { Navigate, useNavigate, useParams } from 'react-router-dom';
import { useSession } from '@/features/auth/hooks/use-session';
import { OnboardingLayout } from '../layouts/onboarding-layout';
import { clearOnboardingImportId, getOnboardingImportId, setOnboardingImportId, setOnboardingResult } from '../lib/storage';
import { isOnboardingStep, type OnboardingStep } from '../lib/steps';
import { CvStep } from '../steps/cv-step';
import { DoneStep } from '../steps/done-step';
import { PreferencesStep } from '../steps/preferences-step';
import { ReviewStep } from '../steps/review-step';
import { WelcomeStep } from '../steps/welcome-step';

/**
 * Machine d'étapes de l'accueil, pilotée par l'URL (`/onboarding` ou
 * `/onboarding/:step`) : une étape inconnue redirige vers « bienvenue », et
 * « vérification » sans import en cours (rechargement après avoir passé
 * l'étape CV, par exemple) redirige vers « cv » plutôt que d'afficher un
 * écran vide. `importId` est initialisé depuis `sessionStorage` pour
 * survivre à un rechargement de page sur l'étape « vérification ».
 */
export function OnboardingPage() {
  const params = useParams<{ step?: string }>();
  const navigate = useNavigate();
  const { data: user } = useSession();
  const [importId, setImportId] = useState<string | null>(() => getOnboardingImportId());

  const rawStep = params.step ?? 'bienvenue';

  if (!isOnboardingStep(rawStep)) {
    return <Navigate to="/onboarding/bienvenue" replace />;
  }

  const step: OnboardingStep = rawStep;

  if (step === 'verification' && !importId) {
    return <Navigate to="/onboarding/cv" replace />;
  }

  function goToStep(next: OnboardingStep): void {
    navigate(`/onboarding/${next}`);
  }

  function handleExtracted(id: string): void {
    setImportId(id);
    setOnboardingImportId(id);
    goToStep('verification');
  }

  function handleReviewBack(): void {
    clearOnboardingImportId();
    setImportId(null);
    goToStep('cv');
  }

  return (
    <OnboardingLayout step={step}>
      {step === 'bienvenue' && <WelcomeStep firstName={user?.firstName ?? ''} onNext={() => goToStep('cv')} />}
      {step === 'cv' && <CvStep onExtracted={handleExtracted} onManual={() => goToStep('preferences')} />}
      {step === 'verification' && importId && (
        <ReviewStep
          importId={importId}
          onApplied={(result) => {
            setOnboardingResult(result);
            goToStep('preferences');
          }}
          onBack={handleReviewBack}
        />
      )}
      {step === 'preferences' && <PreferencesStep importId={importId} onNext={() => goToStep('fin')} />}
      {step === 'fin' && <DoneStep />}
    </OnboardingLayout>
  );
}
