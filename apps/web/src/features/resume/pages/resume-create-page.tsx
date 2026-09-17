import type { ResumeContent, ResumeDto, ResumeTemplate } from '@jobtrack/shared';
import { resumeFileName } from '@jobtrack/shared';
import { AlertCircle, Loader2 } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
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
import { ResumeEditor } from '../components/resume-editor';
import { ResumePreview } from '../components/resume-preview';
import { StepHeader } from '../components/step-header';
import { TailoringStatus } from '../components/tailoring-status';
import { TemplatePicker } from '../components/template-picker';
import { useBaseResume, useTailorResume, useUpdateResume } from '../hooks/use-resume';
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

/**
 * Génération d'un CV adapté (`/resume/create/:jobId`, spec §2/§4/§7, tâche 7) :
 * quatre étapes pilotées par l'URL (`useResumeStep`) — analyse de l'offre
 * (réutilise la tranche 4), adaptation par l'IA avec vue avant/après et
 * édition, aperçu A4, enregistrement puis PDF. Le contenu édité (`content`)
 * et le modèle choisi (`template`) restent en mémoire locale jusqu'à
 * l'enregistrement explicite (étape 4) : aucune écriture serveur avant que
 * l'utilisateur ne le demande.
 */
export function ResumeCreatePage() {
  const params = useParams<{ jobId: string }>();
  const jobId = params.jobId ?? '';
  const { step, goToStep } = useResumeStep();

  const jobQuery = useJob(jobId);
  const matchQuery = useJobMatch(jobId, { enabled: jobId !== '' });
  const analyzeJobs = useAnalyzeJobs();
  const baseResumeQuery = useBaseResume();
  const tailorResume = useTailorResume();

  const [template, setTemplate] = useState<ResumeTemplate>('CLASSIC');
  const didInitTemplate = useRef(false);
  const [resume, setResume] = useState<ResumeDto | null>(null);
  const [content, setContent] = useState<ResumeContent | null>(null);
  const [savedSnapshot, setSavedSnapshot] = useState<ResumeContent | null>(null);
  const updateResume = useUpdateResume(resume?.id ?? '');

  // Modèle par défaut = celui mémorisé pour le CV principal (spec §2), une
  // seule fois : un changement manuel ne doit jamais être écrasé par un
  // rafraîchissement ultérieur de `useBaseResume`.
  useEffect(() => {
    if (!didInitTemplate.current && baseResumeQuery.data) {
      setTemplate(baseResumeQuery.data.template);
      didInitTemplate.current = true;
    }
  }, [baseResumeQuery.data]);

  function handleTailor(): void {
    tailorResume.mutate(
      { jobId, template },
      {
        onSuccess: (created) => {
          setResume(created);
          setContent(created.content);
          setSavedSnapshot(created.content);
        },
      },
    );
  }

  function restoreExperience(id: string): void {
    if (!content || !baseResumeQuery.data) return;
    if (content.experiences.some((item) => item.id === id)) return;
    const baseExperience = baseResumeQuery.data.content.experiences.find((item) => item.id === id);
    if (!baseExperience) return;
    const changeEntry = resume?.changes?.experiences.find((item) => item.id === id);
    const restored: ResumeContent['experiences'][number] = {
      ...baseExperience,
      highlights: changeEntry?.after ?? baseExperience.highlights,
    };
    setContent({ ...content, experiences: [...content.experiences, restored] });
  }

  function restoreEducation(id: string): void {
    if (!content || !baseResumeQuery.data) return;
    if (content.educations.some((item) => item.id === id)) return;
    const item = baseResumeQuery.data.content.educations.find((entry) => entry.id === id);
    if (!item) return;
    setContent({ ...content, educations: [...content.educations, item] });
  }

  function restoreCertification(id: string): void {
    if (!content || !baseResumeQuery.data) return;
    if (content.certifications.some((item) => item.id === id)) return;
    const item = baseResumeQuery.data.content.certifications.find((entry) => entry.id === id);
    if (!item) return;
    setContent({ ...content, certifications: [...content.certifications, item] });
  }

  function restoreProject(id: string): void {
    if (!content || !baseResumeQuery.data) return;
    if (content.projects.some((item) => item.id === id)) return;
    const item = baseResumeQuery.data.content.projects.find((entry) => entry.id === id);
    if (!item) return;
    setContent({ ...content, projects: [...content.projects, item] });
  }

  function handleRestore(section: ResumeChangesSection, id: string): void {
    if (section === 'educations') restoreEducation(id);
    else if (section === 'certifications') restoreCertification(id);
    else restoreProject(id);
  }

  function handleSaveChanges(): void {
    if (!resume || !content) return;
    updateResume.mutate(
      { content, template },
      {
        onSuccess: (updated) => {
          setResume(updated);
          setContent(updated.content);
          setSavedSnapshot(updated.content);
        },
      },
    );
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
  const hasUnsavedChanges = content !== null && savedSnapshot !== null && JSON.stringify(content) !== JSON.stringify(savedSnapshot);
  const removedLabels = baseResumeQuery.data ? buildRemovedLabels(baseResumeQuery.data.content) : undefined;

  return (
    <div className="mx-auto max-w-3xl space-y-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Générer un CV adapté</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          {job.title} — {job.company ?? 'Entreprise non précisée'}
        </p>
      </div>

      <StepHeader current={step} />

      {step === 'analyse' && (
        <div className="space-y-4">
          {(requiredSkills.length > 0 || optionalSkills.length > 0 || job.requirements.length > 0) && (
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
                {job.requirements.filter((requirement) => requirement.required).length > 0 && (
                  <div>
                    <p className="text-sm font-medium">Exigences</p>
                    <ul className="mt-1 space-y-0.5 text-sm text-muted-foreground">
                      {job.requirements
                        .filter((requirement) => requirement.required)
                        .map((requirement, index) => <li key={index}>{requirement.label}</li>)}
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
            <Button type="button" variant="outline" onClick={() => goToStep('selection')}>
              Continuer sans analyse
            </Button>
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
              <CardTitle>Adapter votre CV</CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <TailoringStatus
                profileComplete={baseResumeQuery.data?.profileComplete ?? true}
                error={tailorResume.error}
                onRetry={handleTailor}
              />
              {!resume && (
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
            </CardContent>
          </Card>

          {resume && content && (
            <>
              {resume.changes && (
                <ResumeChanges
                  changes={resume.changes}
                  content={content}
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
                  <ResumeEditor content={content} onChange={setContent} />
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
          {content ? (
            <>
              <TemplatePicker value={template} onChange={setTemplate} />
              <ResumePreview content={content} template={template} />
              <div className="flex justify-end">
                <Button type="button" onClick={() => goToStep('pdf')}>
                  Continuer
                </Button>
              </div>
            </>
          ) : (
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
          {content && resume ? (
            <>
              <div className="flex flex-wrap items-center gap-2">
                <Button type="button" onClick={handleSaveChanges} disabled={!hasUnsavedChanges || updateResume.isPending}>
                  {updateResume.isPending
                    ? 'Enregistrement…'
                    : hasUnsavedChanges
                      ? 'Enregistrer les modifications'
                      : 'Modifications enregistrées'}
                </Button>
                <DownloadPdfButton content={content} template={template} fileName={resumeFileName('CV', content.identity, job.company)} />
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
          ) : (
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
