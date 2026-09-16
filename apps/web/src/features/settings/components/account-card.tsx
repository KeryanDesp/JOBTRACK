import { ErrorState } from '@/components/shared/error-state';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Skeleton } from '@/components/ui/skeleton';
import { useLogout } from '@/features/auth/hooks/use-logout';
import { useSession } from '@/features/auth/hooks/use-session';
import { topLevelMessage } from '@/features/auth/lib/form-errors';

export function AccountCard() {
  const session = useSession();
  const logout = useLogout();

  if (session.isPending) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>Compte</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <Skeleton className="h-9 w-full" />
          <Skeleton className="h-9 w-full" />
        </CardContent>
      </Card>
    );
  }

  if (session.isError) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>Compte</CardTitle>
        </CardHeader>
        <CardContent>
          <ErrorState message={topLevelMessage(session.error)} onRetry={() => void session.refetch()} role="status" />
        </CardContent>
      </Card>
    );
  }

  // La route est protégée : un visiteur non connecté n'atteint jamais cet écran.
  // Repli défensif seulement, pour rester cohérent avec `session.data` typé nullable.
  if (!session.data) return null;

  const { email, firstName, lastName } = session.data;

  return (
    <Card>
      <CardHeader>
        <CardTitle>Compte</CardTitle>
        <CardDescription>Vos informations d'identification.</CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="space-y-2">
          <Label htmlFor="account-email">Adresse email</Label>
          {/* `readOnly`, pas `disabled` : le texte reste sélectionnable/copiable, et un
              champ désactivé n'a pas de nom accessible via `aria-label`. */}
          <Input id="account-email" readOnly value={email} aria-label="Adresse email" />
        </div>
        <div className="space-y-2">
          <Label htmlFor="account-name">Nom</Label>
          <Input id="account-name" readOnly value={`${firstName} ${lastName}`} aria-label="Nom" />
        </div>
      </CardContent>
      <CardFooter>
        <Button variant="destructive" onClick={() => void logout()}>
          Se déconnecter
        </Button>
      </CardFooter>
    </Card>
  );
}
