import type { ActiveSession } from '@jobtrack/shared';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { ErrorState } from '@/components/shared/error-state';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import { topLevelMessage } from '@/features/auth/lib/form-errors';
import { fetchSessions, revokeSession } from '@/services/api/auth';
import { SESSIONS_QUERY_KEY } from '../lib/query-keys';

const dateFormatter = new Intl.DateTimeFormat('fr-FR', { dateStyle: 'long', timeStyle: 'short' });

function formatDate(iso: string): string {
  return dateFormatter.format(new Date(iso));
}

export function SessionsCard() {
  const queryClient = useQueryClient();
  const query = useQuery({ queryKey: SESSIONS_QUERY_KEY, queryFn: fetchSessions });

  const mutation = useMutation({
    mutationFn: (id: string) => revokeSession(id),
    onSuccess: () => {
      toast.success('Appareil déconnecté.');
      void queryClient.invalidateQueries({ queryKey: SESSIONS_QUERY_KEY });
    },
    onError: (error: unknown) => {
      toast.error(topLevelMessage(error));
    },
  });

  if (query.isPending) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>Sessions actives</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <Skeleton className="h-16 w-full" />
          <Skeleton className="h-16 w-full" />
        </CardContent>
      </Card>
    );
  }

  if (query.isError) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>Sessions actives</CardTitle>
        </CardHeader>
        <CardContent>
          <ErrorState message={topLevelMessage(query.error)} onRetry={() => void query.refetch()} role="status" />
        </CardContent>
      </Card>
    );
  }

  const sessions: ActiveSession[] = query.data;

  return (
    <Card>
      <CardHeader>
        <CardTitle>Sessions actives</CardTitle>
        <CardDescription>Les appareils actuellement connectés à votre compte.</CardDescription>
      </CardHeader>
      <CardContent className="space-y-3">
        {sessions.length === 0 ? (
          <p className="text-muted-foreground text-sm">Aucune session active.</p>
        ) : (
          sessions.map((session) => (
            <div
              key={session.id}
              className="flex flex-col gap-2 rounded-lg border p-3 sm:flex-row sm:items-center sm:justify-between"
            >
              <div className="space-y-1">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="line-clamp-1 break-all text-sm font-medium">
                    {session.userAgent ?? 'Appareil inconnu'}
                  </span>
                  {session.current && <Badge variant="secondary">Session actuelle</Badge>}
                </div>
                <p className="text-muted-foreground text-xs">
                  {session.ip ?? 'IP inconnue'} · Dernière activité le {formatDate(session.lastSeenAt)}
                </p>
              </div>
              {!session.current && (
                <Button
                  variant="outline"
                  size="sm"
                  disabled={mutation.isPending}
                  onClick={() => mutation.mutate(session.id)}
                >
                  Déconnecter
                </Button>
              )}
            </div>
          ))
        )}
      </CardContent>
    </Card>
  );
}
