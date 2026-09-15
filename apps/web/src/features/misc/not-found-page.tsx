import { Link } from 'react-router-dom';
import { Logo } from '@/components/shared/logo';
import { Button } from '@/components/ui/button';

export function NotFoundPage() {
  return (
    <div className="bg-background flex min-h-screen flex-col items-center justify-center px-6 text-center">
      <Logo className="mb-10" />
      <p className="text-muted-foreground text-sm font-medium">Erreur 404</p>
      <h1 className="mt-2 text-2xl font-semibold tracking-tight">Cette page n'existe pas.</h1>
      <p className="text-muted-foreground mt-2 max-w-sm text-sm">
        Le lien est peut-être incorrect ou la page a été déplacée.
      </p>
      <Button asChild className="mt-8">
        <Link to="/dashboard">Retour au dashboard</Link>
      </Button>
    </div>
  );
}
