import type { ResumeContent, ResumeTemplate } from '@jobtrack/shared';
import { resumeContentSchema, resumeFileName } from '@jobtrack/shared';
import { useEffect, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { toast } from 'sonner';
import { ErrorState } from '@/components/shared/error-state';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Skeleton } from '@/components/ui/skeleton';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { ApiError } from '@/services/api/client';
import { DownloadPdfButton } from '../components/download-pdf-button';
import { ResumeChanges } from '../components/resume-changes';
import { ResumeEditor } from '../components/resume-editor';
import { ResumePreview } from '../components/resume-preview';
import { TemplatePicker } from '../components/template-picker';
import { useDeleteResume, useResume, useUpdateResume } from '../hooks/use-resume';

function DetailSkeleton() {
  return (
    <div className="mx-auto max-w-3xl space-y-6" role="status" aria-busy="true">
      <span className="sr-only">Chargement du CV…</span>
      <Skeleton className="h-8 w-2/3" />
      <Skeleton className="mx-auto h-[500px] w-full max-w-[420px]" />
    </div>
  );
}

function formatDate(iso: string): string {
  return new Intl.DateTimeFormat('fr-FR', { dateStyle: 'long' }).format(new Date(iso));
}

/**
 * CV adapté enregistré (`/resume/:id`, spec §2/§7, tâche 7) : en-tête avec
 * traçabilité (date, offre liée), modèle mémorisé, trois onglets (Aperçu /
 * Modifications — lecture seule, seulement si `changes` existe / Modifier —
 * crée une nouvelle version `USER`), téléchargement PDF, suppression.
 * `content`/`templateOverride` ne portent que les éditions **locales** non
 * encore enregistrées (`useEffect` réinitialisé sur `id` : naviguer vers un
 * autre CV via ce même composant de route ne doit jamais garder les brouillons
 * du précédent) ; `effectiveContent`/`effectiveTemplate` retombent sur la
 * version serveur tant qu'aucune édition locale n'existe, sans passer par un
 * effet qui laisserait un rendu intermédiaire à `null`.
 */
export function ResumeDetailPage() {
  const params = useParams<{ id: string }>();
  const id = params.id ?? '';
  const navigate = useNavigate();
  const resumeQuery = useResume(id);
  const updateResume = useUpdateResume(id);
  const deleteResume = useDeleteResume();

  const [tab, setTab] = useState('apercu');
  const [content, setContent] = useState<ResumeContent | null>(null);
  const [templateOverride, setTemplateOverride] = useState<ResumeTemplate | null>(null);
  const [confirmDeleteOpen, setConfirmDeleteOpen] = useState(false);

  useEffect(() => {
    setContent(null);
    setTemplateOverride(null);
    setTab('apercu');
  }, [id]);

  const effectiveContent = content ?? resumeQuery.data?.content ?? null;
  const effectiveTemplate = templateOverride ?? resumeQuery.data?.template ?? 'CLASSIC';

  function handleTemplateChange(next: ResumeTemplate): void {
    setTemplateOverride(next);
    if (resumeQuery.data) {
      updateResume.mutate({ content: resumeQuery.data.content, template: next });
    }
  }

  function handleSaveEdits(): void {
    if (!effectiveContent) return;
    const result = resumeContentSchema.safeParse(effectiveContent);
    if (!result.success) {
      toast.error('Le contenu du CV est invalide.');
      return;
    }
    updateResume.mutate(
      { content: result.data, template: effectiveTemplate },
      {
        onSuccess: (updated) => {
          setContent(updated.content);
          setTemplateOverride(updated.template);
          toast.success('CV enregistré.');
        },
      },
    );
  }

  function handleConfirmDelete(): void {
    setConfirmDeleteOpen(false);
    deleteResume.mutate(id, { onSuccess: () => navigate('/resume') });
  }

  if (resumeQuery.isPending) return <DetailSkeleton />;

  if (resumeQuery.isError) {
    const notFound = resumeQuery.error instanceof ApiError && resumeQuery.error.status === 404;
    if (notFound) {
      return (
        <div className="mx-auto max-w-3xl space-y-4 py-16 text-center">
          <p className="text-base font-medium">CV introuvable.</p>
          <Link to="/resume" className="text-sm font-medium text-primary underline-offset-4 hover:underline">
            Retour à Mon CV
          </Link>
        </div>
      );
    }
    const message = resumeQuery.error instanceof ApiError ? resumeQuery.error.message : 'Impossible de charger ce CV. Réessayez.';
    return (
      <div className="mx-auto max-w-3xl">
        <ErrorState message={message} onRetry={() => void resumeQuery.refetch()} />
      </div>
    );
  }

  const resume = resumeQuery.data;

  return (
    <div className="mx-auto max-w-3xl space-y-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">{resume.title}</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Adapté à partir de votre profil le {formatDate(resume.createdAt)}
          {resume.jobTitle &&
            (resume.jobId ? (
              <>
                {' '}
                pour{' '}
                <Link to={`/jobs/${resume.jobId}`} className="underline-offset-4 hover:underline">
                  {resume.jobTitle}
                </Link>
                {resume.company && ` — ${resume.company}`}
              </>
            ) : (
              <> pour {resume.jobTitle}{resume.company && ` — ${resume.company}`}</>
            ))}
        </p>
      </div>

      <TemplatePicker value={effectiveTemplate} onChange={handleTemplateChange} disabled={updateResume.isPending} />

      <Tabs value={tab} onValueChange={setTab}>
        <TabsList>
          <TabsTrigger value="apercu">Aperçu</TabsTrigger>
          {resume.changes && <TabsTrigger value="modifications">Modifications</TabsTrigger>}
          <TabsTrigger value="modifier">Modifier</TabsTrigger>
        </TabsList>

        <TabsContent value="apercu">
          {effectiveContent && <ResumePreview content={effectiveContent} template={effectiveTemplate} />}
        </TabsContent>

        {resume.changes && (
          <TabsContent value="modifications">
            <ResumeChanges changes={resume.changes} content={resume.content} />
          </TabsContent>
        )}

        <TabsContent value="modifier">
          {effectiveContent && (
            <div className="space-y-4">
              <ResumeEditor content={effectiveContent} onChange={setContent} />
              <Button type="button" onClick={handleSaveEdits} disabled={updateResume.isPending}>
                {updateResume.isPending ? 'Enregistrement…' : 'Enregistrer'}
              </Button>
            </div>
          )}
        </TabsContent>
      </Tabs>

      <div className="flex flex-wrap items-center gap-2">
        {effectiveContent && (
          <DownloadPdfButton
            content={effectiveContent}
            template={effectiveTemplate}
            fileName={resumeFileName('CV', effectiveContent.identity, resume.company)}
          />
        )}
        <Button type="button" variant="outline" onClick={() => setConfirmDeleteOpen(true)}>
          Supprimer
        </Button>
      </div>

      <Dialog open={confirmDeleteOpen} onOpenChange={setConfirmDeleteOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Supprimer ce CV ?</DialogTitle>
            <DialogDescription>Cette action est irréversible.</DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => setConfirmDeleteOpen(false)}>
              Annuler
            </Button>
            <Button type="button" variant="destructive" onClick={handleConfirmDelete}>
              Supprimer
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
