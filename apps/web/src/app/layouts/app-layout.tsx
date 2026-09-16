import { LogOut, Settings, User } from 'lucide-react';
import { Link, Outlet } from 'react-router-dom';
import { ThemeToggle } from '@/components/shared/theme-toggle';
import { Avatar, AvatarFallback } from '@/components/ui/avatar';
import { Button } from '@/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { Skeleton } from '@/components/ui/skeleton';
import { useLogout } from '@/features/auth/hooks/use-logout';
import { useSession } from '@/features/auth/hooks/use-session';
import { AppBottomNav } from './app-bottom-nav';
import { AppSidebar } from './app-sidebar';

/** Initiales affichées dans l'avatar ; `'?'` si le prénom et le nom sont tous deux vides. */
function initials(firstName: string, lastName: string): string {
  const combined = `${firstName.trim().charAt(0)}${lastName.trim().charAt(0)}`.toUpperCase();
  return combined || '?';
}

function UserMenu() {
  const session = useSession();
  const logout = useLogout();

  // Taille alignée sur `Avatar` (size-8 par défaut) : sans ce squelette, l'en-tête
  // « sautait » d'un pixel/layout au moment où l'avatar apparaissait.
  if (session.isPending) {
    return <Skeleton className="size-8 rounded-full" />;
  }

  // Visiteur (ne devrait pas arriver ici, la route est protégée) : pas d'avatar tant
  // qu'on n'a rien à y afficher.
  if (!session.data) return null;
  const { firstName, lastName } = session.data;

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="ghost" size="icon" className="rounded-full" aria-label="Menu utilisateur">
          <Avatar>
            <AvatarFallback>{initials(firstName, lastName)}</AvatarFallback>
          </Avatar>
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end">
        <DropdownMenuItem asChild>
          <Link to="/profile">
            <User />
            Mon profil
          </Link>
        </DropdownMenuItem>
        <DropdownMenuItem asChild>
          <Link to="/settings">
            <Settings />
            Paramètres
          </Link>
        </DropdownMenuItem>
        <DropdownMenuSeparator />
        <DropdownMenuItem variant="destructive" onClick={() => void logout()}>
          <LogOut />
          Se déconnecter
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

export function AppLayout() {
  return (
    <div className="bg-background flex min-h-screen">
      <AppSidebar />

      <div className="flex min-w-0 flex-1 flex-col">
        <header className="border-border flex h-14 items-center justify-end gap-2 border-b px-4 lg:px-8">
          <ThemeToggle />
          <UserMenu />
        </header>

        {/* pb-20 laisse la place à la bottom navigation sur mobile. */}
        <main className="flex-1 px-4 py-6 pb-20 lg:px-8 lg:pb-6">
          <Outlet />
        </main>
      </div>

      <AppBottomNav />
    </div>
  );
}
