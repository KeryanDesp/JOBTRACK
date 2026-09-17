import { formatRelativeTime } from '../lib/format';

interface JobFreshnessProps {
  publishedAt: string;
  className?: string;
}

/**
 * Fraîcheur relative d'une offre (spec §2/§7 : « Publié il y a 2 heures »).
 * `<time dateTime>` porte la valeur ISO exacte pour les lecteurs d'écran et
 * les outils d'extraction, le texte affiché restant la version relative.
 */
export function JobFreshness({ publishedAt, className }: JobFreshnessProps) {
  return (
    <time dateTime={publishedAt} className={className}>
      Publié {formatRelativeTime(publishedAt)}
    </time>
  );
}
