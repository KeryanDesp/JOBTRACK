import type { JobSummaryDto } from '@jobtrack/shared';
import { EXPERIENCE_LEVEL_LABELS, REMOTE_MODE_LABELS } from '@jobtrack/shared';
import { memo } from 'react';
import { Link } from 'react-router-dom';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { formatLocation, formatSalaryRange } from '../lib/format';
import { JobFreshness } from './job-freshness';
import { SaveJobButton } from './save-job-button';

interface JobCardProps {
  job: JobSummaryDto;
}

/**
 * Carte de résultat (spec §2/§7) : titre, entreprise, lieu, badges, fraîcheur,
 * compétences, actions. `memo` : dans la liste, la bascule optimiste d'une
 * seule carte (`useSaveJob`) ne change la référence que de l'objet `job`
 * concerné (spec `use-jobs.ts`) — sans `memo`, chaque bascule re-rendrait
 * inutilement toutes les autres cartes de la page.
 */
function JobCardComponent({ job }: JobCardProps) {
  const salary = formatSalaryRange(job.salaryMinAnnual, job.salaryMaxAnnual, job.currency);
  const location = formatLocation(job.locationLabel, job.departmentCode);
  // Les compétences exigées passent déjà en premier côté API (spec §6) : pas de tri ici.
  const topSkills = job.skills.slice(0, 3);

  return (
    <Card className="gap-3 p-5">
      <div className="flex items-start justify-between gap-4">
        <div className="min-w-0">
          <h3 className="text-base font-semibold">
            <Link to={`/jobs/${job.id}`} className="hover:underline">
              {job.title}
            </Link>
          </h3>
          <p className="mt-0.5 truncate text-sm text-muted-foreground">
            {job.company ?? 'Entreprise non précisée'} · {location}
          </p>
        </div>
        <SaveJobButton jobId={job.id} saved={job.saved} className="shrink-0" />
      </div>

      <div className="flex flex-wrap items-center gap-2">
        {job.expiredAt && <Badge variant="secondary">Plus publiée</Badge>}
        {job.contractLabel && <Badge variant="outline">{job.contractLabel}</Badge>}
        {salary && <Badge variant="outline">{salary}</Badge>}
        {job.remoteMode &&
          (job.remoteModeInferred ? (
            <Tooltip>
              <TooltipTrigger asChild>
                {/* `<button>` plutôt que le badge lui-même : un `<span>` n'est jamais focusable/atteignable au clavier. */}
                <button type="button" className="cursor-default rounded-full">
                  <Badge variant="outline">{REMOTE_MODE_LABELS[job.remoteMode]}</Badge>
                </button>
              </TooltipTrigger>
              <TooltipContent>Télétravail mentionné dans l&apos;annonce</TooltipContent>
            </Tooltip>
          ) : (
            <Badge variant="outline">{REMOTE_MODE_LABELS[job.remoteMode]}</Badge>
          ))}
        {job.experienceLevel && <Badge variant="outline">{EXPERIENCE_LEVEL_LABELS[job.experienceLevel]}</Badge>}
      </div>

      <JobFreshness publishedAt={job.publishedAt} className="block text-xs text-muted-foreground" />

      {topSkills.length > 0 && (
        <div className="flex flex-wrap gap-1.5">
          {topSkills.map((skill) => (
            <Badge key={skill} variant="outline" className="text-muted-foreground">
              {skill}
            </Badge>
          ))}
        </div>
      )}

      <div>
        <Button asChild variant="outline" size="sm">
          <Link to={`/jobs/${job.id}`}>Voir</Link>
        </Button>
      </div>
    </Card>
  );
}

export const JobCard = memo(JobCardComponent);
