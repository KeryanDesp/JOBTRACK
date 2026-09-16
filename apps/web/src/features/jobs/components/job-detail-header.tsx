import type { JobDetailDto } from '@jobtrack/shared';
import { EXPERIENCE_LEVEL_LABELS, JOB_SOURCE_LABELS, REMOTE_MODE_LABELS } from '@jobtrack/shared';
import type { ReactNode } from 'react';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { formatLocation, formatSalaryRange } from '../lib/format';
import { JobFreshness } from './job-freshness';
import { SaveJobButton } from './save-job-button';

interface JobDetailHeaderProps {
  job: JobDetailDto;
}

/** `http(s)` uniquement : jamais un logo/lien externe vers un schéma non fiable (spec §5/§8). */
function isHttpUrl(value: string | null): value is string {
  return value !== null && /^https?:\/\//.test(value);
}

/** Repli du logo (spec tâche 9) : initiale de l'entreprise, ou du titre à défaut. */
function initialFor(job: JobDetailDto): string {
  const label = (job.company ?? job.title).trim();
  return label.length > 0 ? label.charAt(0).toUpperCase() : '?';
}

/**
 * Composition icône + texte (spec tâche 9) : `SaveJobButton` n'est pas
 * modifié (réutilisé tel quel, avec son propre `aria-label` porteur de l'état
 * accessible) ; le texte adjacent n'est que la version visible pour les
 * personnes voyantes, d'où `aria-hidden` pour éviter une double annonce du
 * même état par un lecteur d'écran.
 */
function SaveAction({ job }: { job: JobDetailDto }) {
  return (
    <div className="inline-flex items-center gap-2 rounded-md border px-2 py-1.5">
      <SaveJobButton jobId={job.id} saved={job.saved} className="size-6 border-none shadow-none" />
      <span aria-hidden="true" className="pr-1 text-sm font-medium">
        {job.saved ? 'Retirer des favoris' : 'Sauvegarder'}
      </span>
    </div>
  );
}

/**
 * Rangée d'actions (spec tâche 9) : rendue deux fois par `JobDetailHeader`
 * (inline sur desktop, barre collante en bas sur mobile) plutôt qu'une seule
 * fois déplacée en CSS — un `<a>`/bouton dupliqué avec `hidden`/`sm:hidden`
 * reste plus simple à auditer que des règles de position qui migreraient le
 * même nœud DOM entre deux emplacements.
 */
function ActionsRow({ job, className }: { job: JobDetailDto; className: string }) {
  const primarySource = job.sources[0];
  return (
    <div className={className}>
      {primarySource && isHttpUrl(primarySource.url) && (
        <Button asChild>
          <a href={primarySource.url} target="_blank" rel="noopener noreferrer">
            Voir l&apos;offre sur {JOB_SOURCE_LABELS[primarySource.kind]}
          </a>
        </Button>
      )}
      <SaveAction job={job} />
    </div>
  );
}

/**
 * En-tête du détail d'une offre (spec §2/§7) : logo (si `http(s)`, sinon
 * initiale), titre, entreprise (lien si `companyUrl` en `http(s)`), lieu,
 * badges (contrat/salaire/télétravail annoté/expérience), fraîcheur et
 * actions. Les actions sont dupliquées dans une barre collante en bas
 * d'écran sur mobile (spec tâche 9) ; `JobDetailPage` réserve l'espace
 * nécessaire en bas de page pour qu'elle ne recouvre jamais le contenu.
 */
export function JobDetailHeader({ job }: JobDetailHeaderProps) {
  const salary = formatSalaryRange(job.salaryMinAnnual, job.salaryMaxAnnual, job.currency);
  const location = formatLocation(job.locationLabel, job.departmentCode);

  let companyNode: ReactNode = 'Entreprise non précisée';
  if (job.company) {
    companyNode = isHttpUrl(job.companyUrl) ? (
      <a href={job.companyUrl} target="_blank" rel="noopener noreferrer" className="hover:underline">
        {job.company}
      </a>
    ) : (
      job.company
    );
  }

  return (
    <div className="space-y-4">
      <div className="flex items-start gap-4">
        <Avatar size="lg">
          {isHttpUrl(job.companyLogoUrl) && <AvatarImage src={job.companyLogoUrl} alt="" />}
          <AvatarFallback>{initialFor(job)}</AvatarFallback>
        </Avatar>
        <div className="min-w-0 flex-1">
          <h1 className="text-2xl font-semibold tracking-tight">{job.title}</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            {companyNode} · {location}
          </p>
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-2">
        {job.contractLabel && <Badge variant="outline">{job.contractLabel}</Badge>}
        {salary && <Badge variant="outline">{salary}</Badge>}
        {job.remoteMode &&
          (job.remoteModeInferred ? (
            <Tooltip>
              <TooltipTrigger asChild>
                <Badge variant="outline">{REMOTE_MODE_LABELS[job.remoteMode]}</Badge>
              </TooltipTrigger>
              <TooltipContent>Télétravail mentionné dans l&apos;annonce</TooltipContent>
            </Tooltip>
          ) : (
            <Badge variant="outline">{REMOTE_MODE_LABELS[job.remoteMode]}</Badge>
          ))}
        {job.experienceLevel && <Badge variant="outline">{EXPERIENCE_LEVEL_LABELS[job.experienceLevel]}</Badge>}
      </div>

      <JobFreshness publishedAt={job.publishedAt} className="block text-xs text-muted-foreground" />

      <ActionsRow job={job} className="hidden flex-wrap items-center gap-3 sm:flex" />

      <div className="fixed inset-x-0 bottom-0 z-40 border-t bg-background pt-3 pb-[max(0.75rem,env(safe-area-inset-bottom))] sm:hidden">
        <ActionsRow job={job} className="mx-auto flex max-w-3xl flex-wrap items-center gap-3 px-4" />
      </div>
    </div>
  );
}
