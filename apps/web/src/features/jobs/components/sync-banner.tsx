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

interface RefreshButtonProps {
  onRefresh: () => void;
  refreshing: boolean;
  size?: 'sm' | 'xs';
}

function RefreshButton({ onRefresh, refreshing, size = 'sm' }: RefreshButtonProps) {
  return (
    <Button type="button" variant="ghost" size={size} onClick={onRefresh} disabled={refreshing}>
      <RefreshCw className={refreshing ? 'animate-spin' : undefined} />
      Actualiser
    </Button>
  );
}

/**
 * Bandeau de fraîcheur de la synchronisation France Travail (spec §2/§7),
 * selon `sync.status` renvoyé par `GET /jobs` : jamais de secret ni de détail
 * technique. `sync.message` (quand fourni par le serveur) est ajouté sous le
 * message générique plutôt que de le remplacer — il précise sans jamais
 * remplacer la phrase déjà validée par la spec. « Actualiser » reste possible
 * même en dégradé (le serveur peut avoir retrouvé France Travail depuis) et
 * en fraîcheur normale (resynchronisation volontaire), pas seulement en cache.
 */
export function SyncBanner({ sync, onRefresh, refreshing }: SyncBannerProps) {
  if (sync.status === 'not_configured') {
    return (
      <Alert>
        <Info />
        <AlertTitle>Connecteur non configuré</AlertTitle>
        <AlertDescription>
          <p>
            Le connecteur France Travail n&apos;est pas configuré (identifiants absents). Les offres apparaîtront dès qu&apos;il
            le sera.
          </p>
          {sync.message && <p>{sync.message}</p>}
        </AlertDescription>
      </Alert>
    );
  }

  if (sync.status === 'degraded') {
    return (
      <Alert variant="destructive">
        <AlertTriangle />
        <AlertTitle>Synchronisation indisponible</AlertTitle>
        <AlertDescription>
          <p>Résultats en cache : France Travail ne répond pas.</p>
          {sync.message && <p>{sync.message}</p>}
          <RefreshButton onRefresh={onRefresh} refreshing={refreshing} />
        </AlertDescription>
      </Alert>
    );
  }

  if (sync.status === 'cached') {
    return (
      <div className="flex items-center gap-3 text-sm text-muted-foreground">
        <span>
          Actualisé {sync.syncedAt ? formatRelativeTime(sync.syncedAt) : 'récemment'}
          {sync.message ? ` · ${sync.message}` : ''}
        </span>
        <RefreshButton onRefresh={onRefresh} refreshing={refreshing} />
      </div>
    );
  }

  return (
    <div className="flex items-center gap-2 text-sm text-muted-foreground">
      <span>
        Actualisé à l&apos;instant
        {sync.message ? ` · ${sync.message}` : ''}
      </span>
      <RefreshButton onRefresh={onRefresh} refreshing={refreshing} size="xs" />
    </div>
  );
}
