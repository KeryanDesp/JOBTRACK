import { motion } from 'framer-motion';
import { ChevronLeft } from 'lucide-react';
import type { ReactNode } from 'react';
import { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { Logo } from '@/components/shared/logo';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { useCompleteOnboarding } from '@/features/cv-import/hooks/use-cv-import';
import { StepIndicator } from '../components/step-indicator';
import { ONBOARDING_STEPS, type OnboardingStep } from '../lib/steps';

interface OnboardingLayoutProps {
  step: OnboardingStep;
  children: ReactNode;
}

/**
 * Coquille commune aux cinq étapes de l'accueil : logo, indicateur d'étapes,
 * contenu centré (`max-w-2xl`), « Précédent » / « Passer » (spec §2). «
 * Précédent » navigue vers l'étape qui précède `step` dans `ONBOARDING_STEPS`
 * — masqué sur la première (rien avant) et la dernière (l'accueil est déjà
 * terminé, revenir en arrière n'a plus de sens). `MotionConfig
 * reducedMotion="user"` est posé une fois pour toute l'app dans `main.tsx` :
 * la transition ci-dessous respecte donc `prefers-reduced-motion` sans code
 * supplémentaire ici. `key={step}` force le remontage de la transition à
 * chaque changement d'étape (sinon Framer Motion ne rejouerait l'animation
 * qu'au premier montage du layout, pas à chaque navigation entre étapes).
 */
export function OnboardingLayout({ step, children }: OnboardingLayoutProps) {
  const navigate = useNavigate();
  const completeOnboarding = useCompleteOnboarding();
  const [skipOpen, setSkipOpen] = useState(false);

  const currentIndex = ONBOARDING_STEPS.findIndex((entry) => entry.key === step);
  const previousStep = step !== 'fin' && currentIndex > 0 ? ONBOARDING_STEPS[currentIndex - 1] : undefined;

  function handleConfirmSkip(): void {
    completeOnboarding.mutate(undefined, {
      onSuccess: () => {
        setSkipOpen(false);
        navigate('/profile', { replace: true });
      },
    });
  }

  return (
    <div className="bg-background flex min-h-screen flex-col items-center px-4 py-10">
      <div className="w-full max-w-2xl space-y-8">
        <header className="flex items-center justify-between gap-4">
          <Link to="/" aria-label="JobTrack, accueil">
            <Logo />
          </Link>
          {step !== 'fin' && (
            <Button variant="ghost" size="sm" onClick={() => setSkipOpen(true)}>
              Passer
            </Button>
          )}
        </header>

        <StepIndicator current={step} />

        <motion.div key={step} initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.2 }}>
          {children}
        </motion.div>

        {previousStep && (
          <Button variant="ghost" size="sm" onClick={() => navigate(`/onboarding/${previousStep.key}`)}>
            <ChevronLeft />
            Précédent
          </Button>
        )}
      </div>

      <Dialog open={skipOpen} onOpenChange={setSkipOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Passer la configuration ?</DialogTitle>
            <DialogDescription>Vous pourrez importer votre CV plus tard depuis votre profil.</DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setSkipOpen(false)}>
              Annuler
            </Button>
            <Button onClick={handleConfirmSkip} disabled={completeOnboarding.isPending}>
              Passer
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
