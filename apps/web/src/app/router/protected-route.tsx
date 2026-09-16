import { Navigate, Outlet, useLocation } from 'react-router-dom';
import { ErrorState } from '@/components/shared/error-state';
import { Skeleton } from '@/components/ui/skeleton';
import { useSession } from '@/features/auth/hooks/use-session';

/**
 * Garde de route : affiche un squelette pendant la vérification de session,
 * un état d'erreur (avec nouvelle tentative) si elle échoue, redirige vers
 * `/login` (en mémorisant l'origine complète) si personne n'est connecté,
 * sinon rend la route enfant.
 */
export function ProtectedRoute() {
  const { data: user, isPending, isError, refetch } = useSession();
  const location = useLocation();

  if (isPending) {
    return (
      <div className="space-y-4 p-4" role="status" aria-busy="true">
        <span className="sr-only">Vérification de votre session en cours…</span>
        <Skeleton className="h-8 w-1/3" />
        <Skeleton className="h-40 w-full" />
      </div>
    );
  }

  if (isError) {
    return (
      <ErrorState
        message="Impossible de vérifier votre session. Réessayez."
        onRetry={() => void refetch()}
      />
    );
  }

  if (!user) {
    return (
      <Navigate
        to="/login"
        replace
        state={{ from: `${location.pathname}${location.search}${location.hash}` }}
      />
    );
  }

  return <Outlet />;
}
