interface BreakdownRow {
  /** Clé stable (source, nom d'entreprise) — distincte du libellé affiché. */
  key: string;
  label: string;
  count: number;
}

interface BreakdownListProps {
  rows: BreakdownRow[];
  /** Phrase affichée à la place de la liste quand il n'y a rien à répartir. */
  emptyLabel: string;
}

/**
 * Répartition en liste : un libellé, son compte, et une barre de proportion en fond. La barre
 * est `aria-hidden` (elle ne fait que répéter le chiffre à côté) et se cale sur la ligne la
 * plus haute, pas sur le total : sur six sources dont une domine, une échelle au total
 * écraserait les cinq autres à quelques pixels.
 *
 * Les lignes arrivent déjà triées par l'API ; ce composant ne réordonne rien.
 */
export function BreakdownList({ rows, emptyLabel }: BreakdownListProps) {
  if (rows.length === 0) {
    return <p className="text-muted-foreground py-8 text-center text-sm">{emptyLabel}</p>;
  }

  const max = Math.max(...rows.map((row) => row.count));

  return (
    <ul className="space-y-3">
      {rows.map((row) => (
        <li key={row.key}>
          <div className="flex items-baseline justify-between gap-4">
            <span className="min-w-0 truncate text-sm">{row.label}</span>
            <span className="text-sm font-medium tabular-nums">{row.count}</span>
          </div>
          <div className="bg-muted mt-1.5 h-1.5 w-full overflow-hidden rounded-full" aria-hidden>
            <div className="bg-primary/70 h-full rounded-full" style={{ width: `${(row.count / max) * 100}%` }} />
          </div>
        </li>
      ))}
    </ul>
  );
}
