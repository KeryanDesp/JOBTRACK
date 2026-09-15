import { Link } from 'react-router-dom';
import { Logo } from '@/components/shared/logo';
import { ThemeToggle } from '@/components/shared/theme-toggle';
import { Button } from '@/components/ui/button';

export function LandingHeader() {
  return (
    <header className="border-border/60 bg-background/80 sticky top-0 z-50 border-b backdrop-blur-sm">
      <div className="mx-auto flex h-16 max-w-5xl items-center justify-between px-6">
        <Link to="/" aria-label="JobTrack, accueil">
          <Logo />
        </Link>

        <div className="flex items-center gap-2">
          <ThemeToggle />
          <Button variant="ghost" asChild className="hidden sm:inline-flex">
            <Link to="/login">Se connecter</Link>
          </Button>
          <Button asChild>
            <Link to="/register">Commencer gratuitement</Link>
          </Button>
        </div>
      </div>
    </header>
  );
}
