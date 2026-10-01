import type { ApplicationDto } from '@jobtrack/shared';
import { Link } from 'react-router-dom';
import { ApplicationStatusBadge } from '@/features/applications/components/application-status-badge';
import { EMPTY_VALUE, formatApplicationDate } from '@/features/applications/lib/format';

interface RecentApplicationsProps {
  items: ApplicationDto[];
}

/**
 * Les dernières candidatures mises à jour. Chaque ligne mène au panneau de détail de la page
 * « Mes candidatures » (`?candidature=<id>`), le même que la table et le Kanban ouvrent : le
 * tableau de bord n'a pas sa propre vue de détail à maintenir en parallèle.
 */
export function RecentApplications({ items }: RecentApplicationsProps) {
  return (
    <ul className="divide-border divide-y">
      {items.map((application) => (
        <li key={application.id}>
          <Link
            to={`/applications?candidature=${encodeURIComponent(application.id)}`}
            className="hover:bg-muted/50 focus-visible:ring-ring flex items-center gap-4 rounded-md px-2 py-3 focus-visible:ring-2 focus-visible:outline-none"
          >
            <div className="min-w-0 flex-1">
              <p className="truncate text-sm font-medium">{application.jobTitle}</p>
              <p className="text-muted-foreground truncate text-xs">
                {application.company ?? EMPTY_VALUE} · {formatApplicationDate(application.appliedAt)}
              </p>
            </div>
            <ApplicationStatusBadge status={application.status} className="shrink-0" />
          </Link>
        </li>
      ))}
    </ul>
  );
}
