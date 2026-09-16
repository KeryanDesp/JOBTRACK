import type { JobSourceDto } from '@jobtrack/shared';
import { JOB_SOURCE_LABELS } from '@jobtrack/shared';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { isHttpUrl } from '../lib/format';

interface JobSourcesProps {
  sources: JobSourceDto[];
}

/**
 * « Disponible sur » (spec §2/§7) : une ligne par source connue de l'offre,
 * avec le nombre d'annonces du même type quand il y en a plusieurs, le nom du
 * partenaire éventuel, la date de publication propre à cette source et un
 * lien externe. Masqué si l'offre ne porte aucune source (cas normalement
 * inatteignable, `JobDetailDto.sources` venant toujours d'au moins l'ingestion
 * qui a créé l'offre).
 */
export function JobSources({ sources }: JobSourcesProps) {
  if (sources.length === 0) return null;

  const countByKind = sources.reduce<Record<string, number>>((counts, source) => {
    counts[source.kind] = (counts[source.kind] ?? 0) + 1;
    return counts;
  }, {});

  return (
    <Card>
      <CardHeader>
        <CardTitle>Disponible sur</CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        {sources.map((source, index) => {
          const count = countByKind[source.kind] ?? 1;
          const publishedDate = new Date(source.publishedAt).toLocaleDateString('fr-FR');
          return (
            <div
              key={`${source.kind}-${source.externalId}-${index}`}
              className="flex flex-wrap items-center justify-between gap-3 border-t pt-3 text-sm first:border-t-0 first:pt-0"
            >
              <div>
                <p className="font-medium">
                  {JOB_SOURCE_LABELS[source.kind]}
                  {count > 1 && <span className="text-muted-foreground"> ({count} annonces)</span>}
                  {source.partnerName && <span className="text-muted-foreground"> · {source.partnerName}</span>}
                </p>
                <p className="text-xs text-muted-foreground">Publié le {publishedDate}</p>
              </div>
              {isHttpUrl(source.url) && (
                <Button asChild variant="outline" size="sm">
                  <a
                    href={source.url}
                    target="_blank"
                    rel="noopener noreferrer"
                    aria-label={`Voir l'annonce sur ${JOB_SOURCE_LABELS[source.kind]}`}
                  >
                    Voir l&apos;annonce
                  </a>
                </Button>
              )}
            </div>
          );
        })}
      </CardContent>
    </Card>
  );
}
