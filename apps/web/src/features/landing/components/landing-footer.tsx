import { Link } from 'react-router-dom';
import { Logo } from '@/components/shared/logo';

export function LandingFooter() {
  return (
    <footer className="border-border/60 border-t px-6 py-12">
      <div className="text-muted-foreground mx-auto flex max-w-5xl flex-col gap-6 text-sm sm:flex-row sm:items-center sm:justify-between">
        <Logo className="text-foreground" />
        <nav className="flex flex-wrap gap-6" aria-label="Liens de pied de page">
          <Link to="/login" className="hover:text-foreground">
            Se connecter
          </Link>
          <Link to="/register" className="hover:text-foreground">
            Créer un compte
          </Link>
        </nav>
        <p>© {new Date().getFullYear()} JobTrack</p>
      </div>
    </footer>
  );
}
