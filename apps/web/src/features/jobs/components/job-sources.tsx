import type { JobSourceDto } from '@jobtrack/shared';
import { JOB_SOURCE_LABELS } from '@jobtrack/shared';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { isHttpUrl } from '../lib/format';

interface JobSourcesProps {
  sources: JobSourceDto[];
}

/** Une source connue de l'offre, regroupée par type (`kind`) avec ses annonces individuelles. */
interface SourceGroup {
  kind: JobSourceDto['kind'];
  entries: JobSourceDto[];
}

/**
 * Regroupe les sources par type (spec §2/§7 : une seule ligne « France
 * Travail (2 annonces) » plutôt que deux lignes identiques) tout en gardant
 * l'ordre de première apparition de chaque type.
 */
function groupSourcesByKind(sources: JobSourceDto[]): SourceGroup[] {
  const groups: SourceGroup[] = [];
  const indexByKind = new Map<JobSourceDto['kind'], number>();
  for (const source of sources) {
    const existingIndex = indexByKind.get(source.kind);
    if (existingIndex === undefined) {
      indexByKind.set(source.kind, groups.length);
      groups.push({ kind: source.kind, entries: [source] });
    } else {
      groups[existingIndex]?.entries.push(source);
    }
  }
  return groups;
}

/**
 * « Disponible sur » (spec §2/§7) : une ligne par type de source connu de
 * l'offre, avec le nombre d'annonces quand il y en a plusieurs du même type,
 * le nom du partenaire éventuel (celui de la première annonce), la date de
 * publication de cette même première annonce et son lien externe ; les
 * annonces supplémentaires du groupe n'ajoutent qu'un second lien (une seule
 * de plus) ou un simple compte (« et n autres ») au-delà. Masqué si l'offre ne
 * porte aucune source (cas normalement inatteignable, `JobDetailDto.sources`
 * venant toujours d'au moins l'ingestion qui a créé l'offre).
 */
export function JobSources({ sources }: JobSourcesProps) {
  if (sources.length === 0) return null;

  const groups = groupSourcesByKind(sources);

  return (
    <Card>
      <CardHeader>
        <CardTitle>Disponible sur</CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        {groups.map(({ kind, entries }) => {
          const [first, ...rest] = entries;
          if (!first) return null;
          const [second] = rest;
          const label = JOB_SOURCE_LABELS[kind];
          const publishedDate = new Date(first.publishedAt).toLocaleDateString('fr-FR');
          const remainingCount = rest.length - (second ? 1 : 0);

          return (
            <div
              key={kind}
              className="flex flex-wrap items-center justify-between gap-3 border-t pt-3 text-sm first:border-t-0 first:pt-0"
            >
              <div>
                <p className="font-medium">
                  {label}
                  {entries.length > 1 && <span className="text-muted-foreground"> ({entries.length} annonces)</span>}
                  {first.partnerName && <span className="text-muted-foreground"> · {first.partnerName}</span>}
                </p>
                <p className="text-xs text-muted-foreground">Publié le {publishedDate}</p>
              </div>
              <div className="flex flex-wrap items-center gap-2">
                {isHttpUrl(first.url) && (
                  <Button asChild variant="outline" size="sm">
                    <a href={first.url} target="_blank" rel="noopener noreferrer" aria-label={`Voir l'annonce sur ${label}`}>
                      Voir l&apos;annonce
                    </a>
                  </Button>
                )}
                {second && isHttpUrl(second.url) && (
                  <Button asChild variant="outline" size="sm">
                    <a href={second.url} target="_blank" rel="noopener noreferrer" aria-label={`Voir une autre annonce sur ${label}`}>
                      Voir l&apos;autre annonce
                    </a>
                  </Button>
                )}
                {remainingCount > 0 && (
                  <span className="text-xs text-muted-foreground">
                    et {remainingCount} autre{remainingCount > 1 ? 's' : ''}
                  </span>
                )}
              </div>
            </div>
          );
        })}
      </CardContent>
    </Card>
  );
}
