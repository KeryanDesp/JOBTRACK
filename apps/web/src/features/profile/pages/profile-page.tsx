import { PageHeader } from '@/components/shared/page-header';
import { PersonalInfoCard } from '../cards/personal-info-card';
import { PreferencesCard } from '../cards/preferences-card';
import { ProfessionalCard } from '../cards/professional-card';
import { CertificationsSection } from '../sections/certifications-section';
import { EducationsSection } from '../sections/educations-section';
import { ExperiencesSection } from '../sections/experiences-section';
import { LanguagesSection } from '../sections/languages-section';
import { ProjectsSection } from '../sections/projects-section';
import { SkillsSection } from '../sections/skills-section';

export function ProfilePage() {
  return (
    <div className="mx-auto max-w-3xl">
      <PageHeader title="Mon profil" description="Gérez vos informations et votre parcours." />
      <div className="space-y-6">
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
