import type { LucideIcon } from 'lucide-react';
import type { ReactNode } from 'react';
import { Card, CardContent } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';

interface StatTileProps {
  label: string;
  /** Valeur déjà formatée (« 12 », « 34 % », « 5 j »). Le tiret cadratin marque l'absence. */
  value: ReactNode;
  icon: LucideIcon;
  /** Précision sous la valeur : unité, période, dénominateur. */
  hint?: string;
}

/**
 * Chiffre clé du tableau de bord et des statistiques. Volontairement sans couleur propre :
 * dans une rangée de quatre, une pastille colorée par tuile ferait lire une hiérarchie qui
 * n'existe pas. La couleur est réservée aux graphiques, où elle porte une information.
 */
export function StatTile({ label, value, icon: Icon, hint }: StatTileProps) {
  return (
    <Card>
      <CardContent className="flex items-start justify-between gap-4 p-5">
        <div className="min-w-0">
          <p className="text-muted-foreground text-sm">{label}</p>
          <p className="mt-1 truncate text-2xl font-semibold tabular-nums">{value}</p>
          {hint && <p className="text-muted-foreground mt-1 text-xs">{hint}</p>}
        </div>
        <div className="bg-muted flex size-9 shrink-0 items-center justify-center rounded-md">
          <Icon className="text-muted-foreground size-4" aria-hidden />
        </div>
      </CardContent>
    </Card>
  );
}

/** Tuile en attente de données : même gabarit, pour que la grille ne saute pas au chargement. */
export function StatTileSkeleton() {
  return (
    <Card>
      <CardContent className="flex items-start justify-between gap-4 p-5">
        <div className="w-full">
          <Skeleton className="h-4 w-24" />
          <Skeleton className="mt-2 h-7 w-16" />
        </div>
        <Skeleton className="size-9 rounded-md" />
      </CardContent>
    </Card>
  );
}
