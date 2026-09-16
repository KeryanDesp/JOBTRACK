import type { JobSyncInfoDto } from '@jobtrack/shared';
import { AlertTriangle, Info, RefreshCw } from 'lucide-react';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { formatRelativeTime } from '../lib/format';

interface SyncBannerProps {
  sync: JobSyncInfoDto;
  onRefresh: () => void;
  refreshing: boolean;
}

/**
 * Bandeau de fraîcheur de la synchronisation France Travail (spec §2/§7),
 * selon `sync.status` renvoyé par `GET /jobs` : jamais de secret ni de détail
 * technique, seulement les quatre messages prévus par la spec.
 */
export function SyncBanner({ sync, onRefresh, refreshing }: SyncBannerProps) {
  if (sync.status === 'not_configured') {
    return (
      <Alert>
        <Info />
        <AlertTitle>Connecteur non configuré</AlertTitle>
        <AlertDescription>
          Le connecteur France Travail n&apos;est pas configuré (identifiants absents). Les offres apparaîtront dès qu&apos;il le
          sera.
        </AlertDescription>
      </Alert>
    );
  }

  if (sync.status === 'degraded') {
    return (
      <Alert variant="destructive">
        <AlertTriangle />
        <AlertTitle>Synchronisation indisponible</AlertTitle>
        <AlertDescription>Résultats en cache : France Travail ne répond pas.</AlertDescription>
      </Alert>
    );
  }

  if (sync.status === 'cached') {
    return (
      <div className="flex items-center gap-3 text-sm text-muted-foreground">
        <span>Actualisé {sync.syncedAt ? formatRelativeTime(sync.syncedAt) : 'récemment'}</span>
        <Button type="button" variant="ghost" size="sm" onClick={onRefresh} disabled={refreshing}>
          <RefreshCw className={refreshing ? 'animate-spin' : undefined} />
          Actualiser
        </Button>
      </div>
    );
  }

  return <p className="text-sm text-muted-foreground">Actualisé à l&apos;instant</p>;
}
