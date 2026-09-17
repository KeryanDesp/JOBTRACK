import type { ResumeContent, ResumeTemplate } from '@jobtrack/shared';
import { resumeContentSchema, resumeFileName } from '@jobtrack/shared';
import { AlertCircle, Loader2 } from 'lucide-react';
import { useEffect, useState } from 'react';
import { Link, useParams, useSearchParams } from 'react-router-dom';
import { toast } from 'sonner';
import { ErrorState } from '@/components/shared/error-state';
import { Alert, AlertTitle } from '@/components/ui/alert';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import { useJob } from '@/features/jobs/hooks/use-jobs';
import { useAnalyzeJobs, useJobMatch } from '@/features/matching/hooks/use-match';
import { ApiError } from '@/services/api/client';
import { DownloadPdfButton } from '../components/download-pdf-button';
import { ResumeChanges, type ResumeChangesSection } from '../components/resume-changes';
import { normalizeResumeContentHighlights, ResumeEditor } from '../components/resume-editor';
import { ResumePreview } from '../components/resume-preview';
import { StepHeader } from '../components/step-header';
import { TailoringStatus } from '../components/tailoring-status';
import { TemplatePicker } from '../components/template-picker';
import { useBaseResume, useResume, useTailorResume, useUpdateResume } from '../hooks/use-resume';
import { useResumeStep } from '../lib/steps';

/** Squelette de chargement (spec tâche 7) : en-tête puis bandeau d'étapes. */
function CreatePageSkeleton() {
  return (
    <div className="mx-auto max-w-3xl space-y-6" role="status" aria-busy="true">
      <span className="sr-only">Chargement de l&apos;offre…</span>
      <Skeleton className="h-8 w-2/3" />
      <Skeleton className="h-16 w-full" />
      <Skeleton className="h-40 w-full" />
    </div>
  );
}

/** Libellés lisibles des formations/certifications/projets écartés (spec §7 étape 2) : depuis le CV de base, seule source qui les conserve. */
function buildRemovedLabels(content: ResumeContent) {
  return {
    educations: Object.fromEntries(
      content.educations.map((item) => [item.id, item.field ? `${item.degree} — ${item.field} · ${item.school}` : `${item.degree} · ${item.school}`]),
    ),
    certifications: Object.fromEntries(content.certifications.map((item) => [item.id, `${item.name} · ${item.issuer}`])),
    projects: Object.fromEntries(content.projects.map((item) => [item.id, item.name])),
  };
}

/** Rôle/entreprise de chaque expérience du CV de base (revue, tâche 7 fixup) : source de vérité pour `ResumeChanges` (spec point 5). */
function buildExperienceLabels(content: ResumeContent) {
  return Object.fromEntries(content.experiences.map((item) => [item.id, { role: item.role, company: item.company }]));
}

/** Message d'une erreur de mutation (« Analyser l'offre »), même principe que `job-detail-page.tsx`. */
function mutationErrorMessage(error: unknown): string {
  if (error instanceof ApiError) return error.message;
  return 'Une erreur est survenue. Veuillez réessayer.';
}

/**
 * Génération d'un CV adapté (`/resume/create/:jobId`, spec §2/§4/§7, tâche 7) :
 * quatre étapes pilotées par l'URL (`useResumeStep`, `?etape=`) — analyse de
 * l'offre (réutilise la tranche 4), adaptation par l'IA avec vue avant/après
 * et édition, aperçu A4, enregistrement puis PDF. Le CV créé est lui-même
 * persisté dans l'URL (`?cv=<id>`, revue tâche 7 fixup point 3) : un
 * rechargement à l'étape « Aperçu »/« PDF » se ré-hydrate depuis le serveur
 * (`useResume`) sans jamais relancer l'adaptation IA. Le contenu édité
 * (`content`) et le modèle choisi (`templateOverride`) restent en mémoire
 * locale (jamais écrits tant que l'utilisateur ne clique pas « Générer mon
 * CV »/« Enregistrer les modifications » à l'étape 4) et retombent sur la
 * version serveur tant qu'aucune édition locale n'existe (même principe que
 * `resume-detail-page.tsx`) — jamais via un effet qui laisserait un rendu
 * intermédiaire à `null`.
 */
export function ResumeCreatePage() {
  const params = useParams<{ jobId: string }>();
  const jobId = params.jobId ?? '';
  const { step, goToStep } = useResumeStep();
  const [searchParams, setSearchParams] = useSearchParams();
  const cvId = searchParams.get('cv');

  const jobQuery = useJob(jobId);
  const matchQuery = useJobMatch(jobId, { enabled: jobId !== '' });
  const analyzeJobs = useAnalyzeJobs();
  const baseResumeQuery = useBaseResume();
  const tailorResume = useTailorResume();
  const resumeByIdQuery = useResume(cvId ?? '');
  const updateResume = useUpdateResume(cvId ?? '');

  const [templateOverride, setTemplateOverride] = useState<ResumeTemplate | null>(null);
  const [content, setContent] = useState<ResumeContent | null>(null);

  // Un CV différent (nouvelle génération, ou navigation vers un autre `?cv=`) : les
  // éditions locales du précédent n'ont plus de sens, jamais gardées.
  useEffect(() => {
    setContent(null);
    setTemplateOverride(null);
  }, [cvId]);

  const resume = resumeByIdQuery.data ?? null;
  const isResumeLoading = cvId !== null && resumeByIdQuery.isPending;
  const resumeLoadError = cvId !== null && resumeByIdQuery.isError ? resumeByIdQuery.error : null;
  const showMissingResumeNotice = !resume && !isResumeLoading && !resumeLoadError;

  const template = templateOverride ?? resume?.template ?? baseResumeQuery.data?.template ?? 'CLASSIC';
  const effectiveContent = content ?? resume?.content ?? null;
  const hasUnsavedChanges =
    resume !== null &&
    effectiveContent !== null &&
    (JSON.stringify(effectiveContent) !== JSON.stringify(resume.content) || template !== resume.template);

  function setCvId(next: string): void {
    setSearchParams(
      (previous) => {
        const params = new URLSearchParams(previous);
        params.set('cv', next);
        return params;
      },
      { replace: true },
    );
  }

  function handleTailor(): void {
    tailorResume.mutate(
      { jobId, template },
      {
        onSuccess: (created) => {
          setContent(null);
          setTemplateOverride(null);
          setCvId(created.id);
        },
      },
    );
  }

  function restoreExperience(id: string): void {
    if (!effectiveContent || !baseResumeQuery.data) return;
    if (effectiveContent.experiences.some((item) => item.id === id)) return;
    const baseExperience = baseResumeQuery.data.content.experiences.find((item) => item.id === id);
    if (!baseExperience) return;
    // L'ancrage serveur ne renseigne `after` que pour une puce reformulée et
    // conservée : une expérience écartée par l'IA porte `after: []` (revue,
    // tâche 7 fixup point 1) — retomber sur les puces de la base dans ce cas,
    // jamais sur un tableau vide.
    const changeEntry = resume?.changes?.experiences.find((item) => item.id === id);
    const highlights = changeEntry && changeEntry.after.length > 0 ? changeEntry.after : baseExperience.highlights;
    setContent({ ...effectiveContent, experiences: [...effectiveContent.experiences, { ...baseExperience, highlights }] });
  }

  function restoreEducation(id: string): void {
    if (!effectiveContent || !baseResumeQuery.data) return;
    if (effectiveContent.educations.some((item) => item.id === id)) return;
    const item = baseResumeQuery.data.content.educations.find((entry) => entry.id === id);
    if (!item) return;
    setContent({ ...effectiveContent, educations: [...effectiveContent.educations, item] });
  }

  function restoreCertification(id: string): void {
    if (!effectiveContent || !baseResumeQuery.data) return;
    if (effectiveContent.certifications.some((item) => item.id === id)) return;
    const item = baseResumeQuery.data.content.certifications.find((entry) => entry.id === id);
    if (!item) return;
    setContent({ ...effectiveContent, certifications: [...effectiveContent.certifications, item] });
  }

  function restoreProject(id: string): void {
    if (!effectiveContent || !baseResumeQuery.data) return;
    if (effectiveContent.projects.some((item) => item.id === id)) return;
    const item = baseResumeQuery.data.content.projects.find((entry) => entry.id === id);
    if (!item) return;
    setContent({ ...effectiveContent, projects: [...effectiveContent.projects, item] });
  }

  function handleRestore(section: ResumeChangesSection, id: string): void {
    if (section === 'educations') restoreEducation(id);
    else if (section === 'certifications') restoreCertification(id);
    else restoreProject(id);
  }

  /** Étape 4, bouton « Générer mon CV » (spec, revue tâche 7 fixup point 11) : enregistre uniquement si le contenu ou le modèle a changé, puis révèle « Télécharger le PDF ». */
  function handleGenerate(): void {
    if (!resume || !effectiveContent) return;
    const normalized = normalizeResumeContentHighlights(effectiveContent);
    const parsed = resumeContentSchema.safeParse(normalized);
    if (!parsed.success) {
      toast.error('Le contenu du CV est invalide.');
      return;
    }
    updateResume.mutate({ content: parsed.data, template });
  }

  if (jobQuery.isPending) return <CreatePageSkeleton />;

  if (jobQuery.isError) {
    const message = jobQuery.error instanceof ApiError ? jobQuery.error.message : "Impossible de charger l'offre. Réessayez.";
    return (
      <div className="mx-auto max-w-3xl">
        <ErrorState message={message} onRetry={() => void jobQuery.refetch()} />
      </div>
    );
  }

  const job = jobQuery.data;
  const requiredSkills = job.skills.filter((skill) => skill.required);
  const optionalSkills = job.skills.filter((skill) => !skill.required);
  const analysisStatus = matchQuery.data?.analysis.status;
  const canContinueFromAnalysis = analysisStatus === 'done';
  const removedLabels = baseResumeQuery.data ? buildRemovedLabels(baseResumeQuery.data.content) : undefined;
  const experienceLabels = baseResumeQuery.data ? buildExperienceLabels(baseResumeQuery.data.content) : undefined;

  return (
    <div className="mx-auto max-w-3xl space-y-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Générer un CV adapté</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          {job.title} — {job.company ?? 'Entreprise non précisée'}
        </p>
      </div>

      <StepHeader current={step} />

      {resumeLoadError && (
        <ErrorState
          message={resumeLoadError instanceof ApiError ? resumeLoadError.message : 'Impossible de charger ce CV. Réessayez.'}
          onRetry={() => void resumeByIdQuery.refetch()}
          role="status"
        />
      )}

      {step === 'analyse' && (
        <div className="space-y-4">
          {(requiredSkills.length > 0 || optionalSkills.length > 0 || job.requirements.length > 0 || job.experienceLabel) && (
            <Card>
              <CardHeader>
                <CardTitle>Compétences et exigences de l&apos;offre</CardTitle>
              </CardHeader>
              <CardContent className="space-y-4">
                {requiredSkills.length > 0 && (
                  <div>
                    <p className="text-sm font-medium">Technologies exigées</p>
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
                    <p className="text-sm font-medium">Technologies souhaitées</p>
                    <div className="mt-1 flex flex-wrap gap-1.5">
                      {optionalSkills.map((skill) => (
                        <Badge key={skill.name} variant="outline" className="text-muted-foreground">
                          {skill.name}
                        </Badge>
                      ))}
                    </div>
                  </div>
                )}
                {job.experienceLabel && (
                  <div>
                    <p className="text-sm font-medium">Expérience</p>
                    <p className="text-sm text-muted-foreground">{job.experienceLabel}</p>
                  </div>
                )}
                {job.requirements.length > 0 && (
                  <div>
                    <p className="text-sm font-medium">Exigences</p>
                    <ul className="mt-1 space-y-0.5 text-sm text-muted-foreground">
                      {job.requirements.map((requirement, index) => (
                        <li key={index}>
                          {requirement.label}
                          {requirement.required ? ' (exigé)' : ' (souhaité)'}
                        </li>
                      ))}
                    </ul>
                  </div>
                )}
              </CardContent>
            </Card>
          )}

          <Card>
            <CardHeader>
              <CardTitle>Analyse IA de l&apos;offre</CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              {analyzeJobs.error && (
                <Alert variant="destructive">
                  <AlertCircle aria-hidden="true" />
                  <AlertTitle>{mutationErrorMessage(analyzeJobs.error)}</AlertTitle>
                </Alert>
              )}

              {analyzeJobs.notConfigured && (
                <Alert>
                  <AlertCircle aria-hidden="true" />
                  <AlertTitle>Le service IA n&apos;est pas configuré.</AlertTitle>
                </Alert>
              )}

              {matchQuery.isPending && (
                <div role="status" className="flex items-center gap-2 text-sm text-muted-foreground">
                  <Loader2 className="size-4 animate-spin" aria-hidden="true" />
                  Chargement du statut d&apos;analyse…
                </div>
              )}

              {(analysisStatus === 'none' || analysisStatus === undefined) && !matchQuery.isPending && (
                <div className="space-y-3">
                  <p className="text-sm text-muted-foreground">Cette offre n&apos;a pas encore été analysée.</p>
                  <Button type="button" onClick={() => analyzeJobs.analyze([jobId])} disabled={analyzeJobs.isAnalyzing}>
                    {analyzeJobs.isAnalyzing ? 'Analyse en cours…' : "Analyser l'offre"}
                  </Button>
                </div>
              )}

              {analysisStatus === 'pending' && (
                <div role="status" aria-live="polite" className="flex items-center gap-2 text-sm text-muted-foreground">
                  <Loader2 className="size-4 animate-spin" aria-hidden="true" />
                  Analyse en cours…
                </div>
              )}

              {analysisStatus === 'failed' && (
                <div className="space-y-3">
                  <Alert variant="destructive">
                    <AlertCircle aria-hidden="true" />
                    <AlertTitle>L&apos;analyse de cette offre a échoué.</AlertTitle>
                  </Alert>
                  <Button type="button" variant="outline" onClick={() => analyzeJobs.analyze([jobId])}>
                    Réessayer l&apos;analyse
                  </Button>
                </div>
              )}

              {analysisStatus === 'ai_not_configured' && (
                <Alert>
                  <AlertCircle aria-hidden="true" />
                  <AlertTitle>Le service IA n&apos;est pas configuré.</AlertTitle>
                </Alert>
              )}

              {analysisStatus === 'done' && (
                <p className="text-sm text-muted-foreground">
                  Offre analysée : l&apos;adaptation de votre CV pourra s&apos;appuyer sur cette analyse.
                </p>
              )}
            </CardContent>
          </Card>

          <div className="flex flex-wrap justify-end gap-2">
            {!canContinueFromAnalysis && (
              <Button type="button" variant="outline" onClick={() => goToStep('selection')}>
                Continuer sans analyse
              </Button>
            )}
            <Button type="button" onClick={() => goToStep('selection')} disabled={!canContinueFromAnalysis}>
              Continuer
            </Button>
          </div>
        </div>
      )}

      {step === 'selection' && (
        <div className="space-y-4">
          <Card>
            <CardHeader>
              <CardTitle>{cvId ? 'CV déjà généré' : 'Adapter votre CV'}</CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <TailoringStatus
                profileComplete={baseResumeQuery.data?.profileComplete ?? true}
                error={tailorResume.error}
                onRetry={handleTailor}
              />
              {!cvId && (
                <Button
                  type="button"
                  onClick={handleTailor}
                  disabled={tailorResume.isPending || baseResumeQuery.data?.profileComplete === false}
                >
                  {tailorResume.isPending ? (
                    <>
                      <Loader2 className="animate-spin" aria-hidden="true" />
                      Adaptation en cours…
                    </>
                  ) : (
                    'Adapter mon CV'
                  )}
                </Button>
              )}
              {cvId && (
                <div className="space-y-2">
                  <Alert>
                    <AlertTitle>CV déjà généré.</AlertTitle>
                  </Alert>
                  <Button type="button" variant="outline" onClick={handleTailor} disabled={tailorResume.isPending}>
                    {tailorResume.isPending ? 'Régénération en cours…' : 'Régénérer'}
                  </Button>
                  <p className="text-xs text-muted-foreground">
                    « Régénérer » crée un nouveau CV adapté distinct ; celui-ci reste disponible dans « Mon CV ».
                  </p>
                </div>
              )}
            </CardContent>
          </Card>

          {isResumeLoading && (
            <div role="status" aria-busy="true">
              <span className="sr-only">Chargement du CV…</span>
              <Skeleton className="h-40 w-full" />
            </div>
          )}

          {resume && effectiveContent && (
            <>
              {resume.changes && (
                <ResumeChanges
                  changes={resume.changes}
                  content={effectiveContent}
                  experienceLabels={experienceLabels}
                  labels={removedLabels}
                  onRestoreExperience={restoreExperience}
                  onRestore={handleRestore}
                />
              )}

              <Card>
                <CardHeader>
                  <CardTitle>Modifier le contenu</CardTitle>
                </CardHeader>
                <CardContent>
                  <ResumeEditor content={effectiveContent} onChange={setContent} />
                </CardContent>
              </Card>

              <div className="flex justify-end">
                <Button type="button" onClick={() => goToStep('apercu')}>
                  Continuer
                </Button>
              </div>
            </>
          )}
        </div>
      )}

      {step === 'apercu' && (
        <div className="space-y-4">
          {isResumeLoading && <Skeleton className="mx-auto h-[500px] w-full max-w-[420px]" />}

          {resume && effectiveContent && (
            <>
              <TemplatePicker value={template} onChange={setTemplateOverride} />
              <ResumePreview content={effectiveContent} template={template} />
              <div className="flex justify-end">
                <Button type="button" onClick={() => goToStep('pdf')}>
                  Continuer
                </Button>
              </div>
            </>
          )}

          {showMissingResumeNotice && (
            <div className="space-y-3">
              <p className="text-sm text-muted-foreground">Adaptez votre CV à l&apos;étape précédente pour voir l&apos;aperçu.</p>
              <Button type="button" variant="outline" onClick={() => goToStep('selection')}>
                Retour à la sélection du contenu
              </Button>
            </div>
          )}
        </div>
      )}

      {step === 'pdf' && (
        <div className="space-y-4">
          {isResumeLoading && <Skeleton className="h-10 w-48" />}

          {resume && effectiveContent && (
            <>
              <div className="flex flex-wrap items-center gap-2">
                {hasUnsavedChanges ? (
                  <Button type="button" onClick={handleGenerate} disabled={updateResume.isPending}>
                    {updateResume.isPending ? 'Enregistrement…' : 'Générer mon CV'}
                  </Button>
                ) : (
                  <DownloadPdfButton
                    content={effectiveContent}
                    template={template}
                    fileName={resumeFileName('CV', effectiveContent.identity, job.company)}
                  />
                )}
              </div>
              <div className="flex flex-wrap gap-3">
                <Button asChild variant="outline">
                  <Link to={`/resume/${resume.id}`}>Voir dans Mon CV</Link>
                </Button>
                <Button asChild variant="outline">
                  <Link to={`/resume/letter/${jobId}`}>Générer une lettre</Link>
                </Button>
              </div>
            </>
          )}

          {showMissingResumeNotice && (
            <div className="space-y-3">
              <p className="text-sm text-muted-foreground">Adaptez votre CV à l&apos;étape précédente pour générer le PDF.</p>
              <Button type="button" variant="outline" onClick={() => goToStep('selection')}>
                Retour à la sélection du contenu
              </Button>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
