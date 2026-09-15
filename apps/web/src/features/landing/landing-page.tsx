import { Link } from 'react-router-dom';
import { Logo } from '@/components/shared/logo';
import { Button } from '@/components/ui/button';

/** Page d'accueil provisoire. La landing complète arrive en tâche 12. */
export function LandingPage() {
  return (
    <div className="bg-background flex min-h-screen flex-col items-center justify-center gap-6 px-6 text-center">
      <Logo />
      <h1 className="text-3xl font-semibold tracking-tight">Toutes vos opportunités. Un seul endroit.</h1>
      <Button asChild>
        <Link to="/dashboard">Ouvrir l'application</Link>
      </Button>
    </div>
  );
}
