import type { JobDetailDto } from '@jobtrack/shared';
import { EXPERIENCE_LEVEL_LABELS, JOB_SOURCE_LABELS, REMOTE_MODE_LABELS } from '@jobtrack/shared';
import { Bookmark, BookmarkCheck } from 'lucide-react';
import type { ReactNode } from 'react';
import { toast } from 'sonner';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { useSaveJob } from '../hooks/use-jobs';
import { formatLocation, formatSalaryRange, isHttpUrl } from '../lib/format';
import { JobFreshness } from './job-freshness';

interface JobDetailHeaderProps {
  job: JobDetailDto;
}

/** Repli du logo (spec tâche 9) : initiale de l'entreprise, ou du titre à défaut. */
function initialFor(job: JobDetailDto): string {
  const label = (job.company ?? job.title).trim();
  return label.length > 0 ? label.charAt(0).toUpperCase() : '?';
}

/**
 * Variante texte du bouton de sauvegarde (revue f9bf90c, point 5) : un seul
 * `<Button>` porte à la fois l'icône, le libellé visible et `aria-pressed` —
 * la cible cliquable et le texte affiché coïncident désormais, plutôt que
 * l'icône (`SaveJobButton`) et un texte adjacent purement décoratif. Ce
 * composant reste local à l'en-tête de détail : `save-job-button.tsx` (icône
 * seule, utilisé par `JobCard`) n'est pas modifié, une autre revue étant en
 * cours sur ce fichier. `useSaveJob` (optimiste + rollback + invalidation)
 * est réutilisé tel quel, sans dupliquer sa logique.
 */
function SaveJobTextButton({ jobId, saved }: { jobId: string; saved: boolean }) {
  const saveJob = useSaveJob();

  function handleClick() {
    const nextSaved = !saved;
    saveJob.mutate(
      { id: jobId, saved: nextSaved },
      {
        onError: () => {
          toast.error(
            nextSaved ? "Impossible de sauvegarder l'offre. Réessayez." : "Impossible de retirer l'offre des favoris. Réessayez.",
          );
        },
      },
    );
  }

  return (
    <Button
      type="button"
      variant={saved ? 'secondary' : 'outline'}
      aria-pressed={saved}
      onClick={handleClick}
      disabled={saveJob.isPending}
    >
      {saved ? <BookmarkCheck /> : <Bookmark />}
      {saved ? 'Retirer des favoris' : 'Sauvegarder'}
    </Button>
  );
}

/**
 * Rangée d'actions (spec tâche 9) : rendue deux fois par `JobDetailHeader`
 * (inline sur desktop, barre collante en bas sur mobile) plutôt qu'une seule
 * fois déplacée en CSS — un `<a>`/bouton dupliqué avec `hidden`/`sm:hidden`
 * reste plus simple à auditer que des règles de position qui migreraient le
 * même nœud DOM entre deux emplacements. Le CTA externe cible la première
 * source dont l'URL est `http(s)` (revue f9bf90c, point 8) plutôt que
 * `sources[0]` sans condition : une source dont l'URL serait absente/invalide
 * ne doit jamais produire un lien mort en tête d'action.
 */
function ActionsRow({ job, className }: { job: JobDetailDto; className: string }) {
  const primarySource = job.sources.find((source) => isHttpUrl(source.url));
  return (
    <div className={className}>
      {primarySource && (
        <Button asChild>
          <a href={primarySource.url} target="_blank" rel="noopener noreferrer">
            Voir l&apos;offre sur {JOB_SOURCE_LABELS[primarySource.kind]}
          </a>
        </Button>
      )}
      <SaveJobTextButton jobId={job.id} saved={job.saved} />
    </div>
  );
}

/** Libellé d'expérience affiché (revue f9bf90c, point 6) : énumération connue en priorité, texte brut de la source à défaut (jamais masqué faute d'énumération reconnue). */
function experienceText(job: JobDetailDto): string | null {
  if (job.experienceLevel) return EXPERIENCE_LEVEL_LABELS[job.experienceLevel];
  return job.experienceLabel;
}

/**
 * En-tête du détail d'une offre (spec §2/§7) : logo (si `http(s)`, sinon
 * initiale), titre, entreprise (lien si `companyUrl` en `http(s)`), lieu,
 * badges (contrat/salaire/télétravail annoté/expérience), fraîcheur et
 * actions. Les actions sont dupliquées dans une barre collante en bas
 * d'écran sur mobile (spec tâche 9) ; `JobDetailPage` réserve l'espace
 * nécessaire en bas de page pour qu'elle ne recouvre jamais le contenu.
 * La barre mobile est positionnée au-dessus de `AppBottomNav` (revue
 * f9bf90c, point 1) — les deux étaient auparavant `fixed bottom-0 z-40` et se
 * recouvraient ; `AppBottomNav` mesure environ 4 rem (`icône + libellé +
 * py-2`), d'où le décalage.
 */
export function JobDetailHeader({ job }: JobDetailHeaderProps) {
  // Repli sur le libellé brut de la source (revue f9bf90c, point 6) : un salaire non
  // reconnu par le mapper (motif inconnu, spec §5) garde `salaryLabel` plutôt que de
  // disparaître complètement de l'en-tête.
  const salary = formatSalaryRange(job.salaryMinAnnual, job.salaryMaxAnnual, job.currency) ?? job.salaryLabel;
  const location = formatLocation(job.locationLabel, job.departmentCode);
  const experience = experienceText(job);

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
                <button
                  type="button"
                  className="rounded-full outline-none focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50"
                >
                  <Badge variant="outline">{REMOTE_MODE_LABELS[job.remoteMode]}</Badge>
                </button>
              </TooltipTrigger>
              <TooltipContent>Télétravail mentionné dans l&apos;annonce</TooltipContent>
            </Tooltip>
          ) : (
            <Badge variant="outline">{REMOTE_MODE_LABELS[job.remoteMode]}</Badge>
          ))}
        {experience && <Badge variant="outline">{experience}</Badge>}
        {job.experienceRequired === false && <Badge variant="outline">Débutant accepté</Badge>}
      </div>

      <JobFreshness publishedAt={job.publishedAt} className="block text-xs text-muted-foreground" />

      <ActionsRow job={job} className="hidden flex-wrap items-center gap-3 sm:flex" />

      {/* `bottom-[calc(4rem+…)]` place la barre au-dessus d'`AppBottomNav` (voir docstring du composant) plutôt qu'à `bottom-0`, où les deux se recouvraient. */}
      <div className="mobile-action-bar fixed inset-x-0 bottom-[calc(4rem+env(safe-area-inset-bottom))] z-40 border-t bg-background pt-3 pb-3 sm:hidden">
        <ActionsRow job={job} className="mx-auto flex max-w-3xl flex-wrap items-center gap-3 px-4" />
      </div>
    </div>
  );
}
