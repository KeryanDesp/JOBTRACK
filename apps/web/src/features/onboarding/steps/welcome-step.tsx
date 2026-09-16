import { Button } from '@/components/ui/button';

interface WelcomeStepProps {
  firstName: string;
  onNext: () => void;
}

/** Première étape de l'accueil : ce qui va se passer, en trois lignes. */
export function WelcomeStep({ firstName, onNext }: WelcomeStepProps) {
  return (
    <div className="space-y-6 text-center">
      <h2 className="text-xl font-semibold tracking-tight">Bienvenue, {firstName}</h2>
      <div className="text-muted-foreground space-y-2 text-sm">
        <p>Importez votre CV pour préremplir votre profil en quelques secondes.</p>
        <p>Vérifiez et ajustez les informations extraites avant de les appliquer.</p>
        <p>Indiquez vos préférences de recherche — ou passez cette étape à tout moment.</p>
      </div>
      <Button onClick={onNext}>Commencer</Button>
    </div>
  );
}
