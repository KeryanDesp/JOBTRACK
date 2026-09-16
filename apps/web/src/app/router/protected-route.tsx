import { Navigate, Outlet, useLocation } from 'react-router-dom';
import { Skeleton } from '@/components/ui/skeleton';
import { useSession } from '@/features/auth/hooks/use-session';

/**
 * Garde de route : affiche un squelette pendant la vérification de session,
 * redirige vers `/login` (en mémorisant l'origine) si personne n'est
 * connecté, sinon rend la route enfant.
 */
export function ProtectedRoute() {
  const { data: user, isPending } = useSession();
  const location = useLocation();

  if (isPending) {
    return (
      <div className="space-y-4 p-4" aria-busy="true">
        <Skeleton className="h-8 w-1/3" />
        <Skeleton className="h-40 w-full" />
      </div>
    );
  }

  if (!user) {
    return <Navigate to="/login" replace state={{ from: location.pathname }} />;
  }

  return <Outlet />;
}
