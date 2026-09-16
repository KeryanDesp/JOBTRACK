import { Upload } from 'lucide-react';
import { Link } from 'react-router-dom';
import { PageHeader } from '@/components/shared/page-header';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { useSession } from '@/features/auth/hooks/use-session';
import { useCompleteOnboarding } from '@/features/cv-import/hooks/use-cv-import';
import { PersonalInfoCard } from '../cards/personal-info-card';
import { PreferencesCard } from '../cards/preferences-card';
import { ProfessionalCard } from '../cards/professional-card';
import { CertificationsSection } from '../sections/certifications-section';
import { EducationsSection } from '../sections/educations-section';
import { ExperiencesSection } from '../sections/experiences-section';
import { LanguagesSection } from '../sections/languages-section';
import { ProjectsSection } from '../sections/projects-section';
import { SkillsSection } from '../sections/skills-section';

/**
 * Rappel discret de l'accueil non terminé : un compte qui l'a passé (ou
 * abandonné en cours) peut toujours l'ouvrir depuis ici, ou l'écarter
 * définitivement (« Plus tard » pose `onboardingCompletedAt` sans y
 * retourner). Rien ne s'affiche si l'accueil est déjà terminé.
 */
function OnboardingBanner() {
  const { data: user } = useSession();
  const completeOnboarding = useCompleteOnboarding();

  if (!user || user.onboardingCompleted) return null;

  return (
    <Alert>
      <AlertTitle>Terminer la configuration</AlertTitle>
      <AlertDescription>
        <p>Importez votre CV et réglez vos préférences pour profiter pleinement de JobTrack.</p>
        <div className="mt-2 flex gap-2">
          <Button asChild size="sm">
            <Link to="/onboarding">Continuer</Link>
          </Button>
          <Button variant="ghost" size="sm" onClick={() => completeOnboarding.mutate()} disabled={completeOnboarding.isPending}>
            Plus tard
          </Button>
        </div>
      </AlertDescription>
    </Alert>
  );
}

export function ProfilePage() {
  return (
    <div className="mx-auto max-w-3xl">
      <PageHeader
        title="Mon profil"
        description="Gérez vos informations et votre parcours."
        actions={
          <Button asChild variant="outline">
            <Link to="/profile/import">
              <Upload />
              Importer un CV
            </Link>
          </Button>
        }
      />
      <div className="space-y-6">
        <OnboardingBanner />
        <PersonalInfoCard />
        <ProfessionalCard />
        <PreferencesCard />
        <ExperiencesSection />
        <EducationsSection />
        <SkillsSection />
        <LanguagesSection />
        <CertificationsSection />
        <ProjectsSection />
      </div>
    </div>
  );
}
