import type { JobDetailDto } from '@jobtrack/shared';
import { FileQuestion } from 'lucide-react';
import { Link, useParams } from 'react-router-dom';
import { ErrorState } from '@/components/shared/error-state';
import { Alert, AlertTitle } from '@/components/ui/alert';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import { TooltipProvider } from '@/components/ui/tooltip';
import { ApiError } from '@/services/api/client';
import { JobDescription } from '../components/job-description';
import { JobDetailHeader } from '../components/job-detail-header';
import { JobRequirements } from '../components/job-requirements';
import { JobSources } from '../components/job-sources';
import { useJob } from '../hooks/use-jobs';
import { formatRelativeTime, isHttpUrl } from '../lib/format';

/** Squelette de chargement (spec tâche 9) : en-tête puis deux blocs de section. */
function DetailSkeleton() {
  return (
    <div className="mx-auto max-w-3xl space-y-6" role="status" aria-busy="true">
      <span className="sr-only">Chargement de l&apos;offre…</span>
      <div className="flex items-start gap-4">
        <Skeleton className="size-10 shrink-0 rounded-full" />
        <div className="flex-1 space-y-2">
          <Skeleton className="h-6 w-2/3" />
          <Skeleton className="h-4 w-1/3" />
        </div>
      </div>
      <Skeleton className="h-40 w-full" />
      <Skeleton className="h-40 w-full" />
    </div>
  );
}

/** Retour vers la liste (spec tâche 9) : toujours `/jobs`, jamais l'historique (`-1`), qui casserait un lien direct sans page précédente. */
function BackToJobsLink() {
  return (
    <Link to="/jobs" className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground">
      {/* Décoratif (revue f9bf90c, point 10) : le lecteur d'écran n'a besoin que du texte « Offres ». */}
      <span aria-hidden="true">←</span>
      Offres
    </Link>
  );
}

/**
 * Bloc dédié 404 (revue f9bf90c, point 3) : un message et un lien de retour,
 * jamais de « Réessayer » — re-demander le même identifiant produirait à
 * nouveau un 404, contrairement à `ErrorState` (réservé aux erreurs
 * transitoires, ci-dessous dans `JobDetailPage`).
 */
function NotFoundBlock() {
  return (
    <div role="status" className="flex flex-col items-center justify-center px-6 py-16 text-center">
      <div className="mb-4 flex size-12 items-center justify-center rounded-full bg-muted">
        <FileQuestion className="size-5 text-muted-foreground" />
      </div>
      <p className="text-base font-medium">Offre introuvable.</p>
      <Link to="/jobs" className="mt-6 text-sm font-medium text-primary underline-offset-4 hover:underline">
        Retour aux offres
      </Link>
    </div>
  );
}

interface ConditionRow {
  label: string;
  value: string;
}

/**
 * Lignes non nulles des conditions (spec tâche 9) : seules celles renseignées
 * apparaissent. La « déplacements » de la spec §2 n'a pas encore de champ
 * dédié dans `JobDetailDto` (revue f9bf90c, point 12) — reportée, pas
 * oubliée : à ajouter ici quand le contrat partagé la portera.
 */
function buildConditionRows(job: JobDetailDto): ConditionRow[] {
  const rows: ConditionRow[] = [];
  if (job.workingTimeLabel) rows.push({ label: 'Durée du travail', value: job.workingTimeLabel });
  if (job.isFullTime !== null) rows.push({ label: 'Temps de travail', value: job.isFullTime ? 'Temps plein' : 'Temps partiel' });
  if (job.contractNature) rows.push({ label: 'Nature du contrat', value: job.contractNature });
  if (job.positionsCount !== null) rows.push({ label: 'Nombre de postes', value: String(job.positionsCount) });
  if (job.accessibleTh !== null) {
    rows.push({ label: 'Accessible aux travailleurs handicapés', value: job.accessibleTh ? 'Oui' : 'Non' });
  }
  if (job.sectorLabel) rows.push({ label: 'Secteur', value: job.sectorLabel });
  if (job.qualificationLabel) rows.push({ label: 'Qualification', value: job.qualificationLabel });
  if (job.romeLabel) {
    rows.push({ label: 'Domaine (ROME)', value: job.romeCode ? `${job.romeLabel} (${job.romeCode})` : job.romeLabel });
  }
  return rows;
}

/**
 * Détail d'une offre (`/jobs/:id`, spec §2/§7, tâche 9) : squelette pendant le
 * chargement, 404 → message dédié avec un lien de retour, autre erreur →
 * `ErrorState` avec réessai, succès → en-tête + sections (description,
 * compétences, formations/langues, entreprise, conditions, sources).
 */
export function JobDetailPage() {
  const { id } = useParams<{ id: string }>();
  const jobQuery = useJob(id ?? '');

  if (jobQuery.isPending) return <DetailSkeleton />;

  if (jobQuery.isError) {
    const notFound = jobQuery.error instanceof ApiError && jobQuery.error.status === 404;
    return (
      <div className="mx-auto max-w-3xl space-y-4">
        <BackToJobsLink />
        {notFound ? (
          <NotFoundBlock />
        ) : (
          <ErrorState message="Impossible de charger l'offre. Réessayez." onRetry={() => void jobQuery.refetch()} />
        )}
      </div>
    );
  }

  const job = jobQuery.data;
  const requiredSkills = job.skills.filter((skill) => skill.required);
  const optionalSkills = job.skills.filter((skill) => !skill.required);
  const hasCompanySection = Boolean(job.company || job.companyDescription || job.companyUrl);
  const conditionRows = buildConditionRows(job);

  return (
    <TooltipProvider>
      {/*
        `pb-28` réserve la hauteur de la barre d'actions collante mobile (voir
        `JobDetailHeader`, revue f9bf90c point 1 : la barre est maintenant
        positionnée au-dessus d'`AppBottomNav`, elle-même déjà couverte par le
        `pb-20` du `<main>` de `AppLayout`) pour qu'elle ne recouvre jamais la
        dernière section.
      */}
      <div className="mx-auto max-w-3xl space-y-6 pb-28 sm:pb-0">
        <BackToJobsLink />

        {job.expiredAt && (
          <Alert variant="destructive">
            <AlertTitle>Cette offre n&apos;est plus publiée.</AlertTitle>
          </Alert>
        )}

        <JobDetailHeader job={job} />

        <JobDescription description={job.description} />

        {job.skills.length > 0 && (
          <Card>
            <CardHeader>
              <CardTitle>Compétences</CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              {requiredSkills.length > 0 && (
                <div>
                  <p className="text-sm font-medium">Exigées</p>
                  <div className="mt-1 flex flex-wrap gap-1.5">
                    {requiredSkills.map((skill) => (
                      <Badge key={skill.name} variant="outline">
                        {skill.name}
                      </Badge>
                    ))}
                  </div>
                </div>
              )}
              {optionalSkills.length > 0 && (
                <div>
                  <p className="text-sm font-medium">Souhaitées</p>
                  <div className="mt-1 flex flex-wrap gap-1.5">
                    {optionalSkills.map((skill) => (
                      <Badge key={skill.name} variant="outline" className="text-muted-foreground">
                        {skill.name}
                      </Badge>
                    ))}
                  </div>
                </div>
              )}
            </CardContent>
          </Card>
        )}

        <JobRequirements requirements={job.requirements} />

        {hasCompanySection && (
          <Card>
            <CardHeader>
              <CardTitle>Entreprise</CardTitle>
            </CardHeader>
            <CardContent className="space-y-2">
              {job.company && <p className="text-sm font-medium">{job.company}</p>}
              {job.companyDescription && <p className="whitespace-pre-line text-sm text-muted-foreground">{job.companyDescription}</p>}
              {isHttpUrl(job.companyUrl) && (
                <a href={job.companyUrl} target="_blank" rel="noopener noreferrer" className="block text-sm text-primary hover:underline">
                  {job.companyUrl}
                </a>
              )}
            </CardContent>
          </Card>
        )}

        {conditionRows.length > 0 && (
          <Card>
            <CardHeader>
              <CardTitle>Conditions</CardTitle>
            </CardHeader>
            <CardContent>
              <dl className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                {conditionRows.map((row) => (
                  <div key={row.label}>
                    <dt className="text-xs text-muted-foreground">{row.label}</dt>
                    <dd className="text-sm">{row.value}</dd>
                  </div>
                ))}
              </dl>
            </CardContent>
          </Card>
        )}

        <JobSources sources={job.sources} />

        <p className="text-xs text-muted-foreground">Vue par JobTrack pour la dernière fois {formatRelativeTime(job.lastSeenAt)}.</p>
      </div>
    </TooltipProvider>
  );
}
