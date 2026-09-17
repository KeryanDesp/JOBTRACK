import { resumeFileName } from '@jobtrack/shared';
import { AlertCircle, Eye, Pencil } from 'lucide-react';
import { useState } from 'react';
import { Link } from 'react-router-dom';
import { ErrorState } from '@/components/shared/error-state';
import { PageHeader } from '@/components/shared/page-header';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Skeleton } from '@/components/ui/skeleton';
import { DownloadPdfButton } from '../components/download-pdf-button';
import { LetterList } from '../components/letter-list';
import { ResumeList } from '../components/resume-list';
import { ResumePreview } from '../components/resume-preview';
import { TemplatePicker } from '../components/template-picker';
import { useBaseResume, useLetters, useResumeTemplate, useResumes } from '../hooks/use-resume';

/** Squelette de chargement du CV principal (spec §2/§7) : un bloc A4 gris plutôt qu'un aperçu vide. */
function BaseResumeSkeleton() {
  return (
    <div role="status" aria-busy="true">
      <span className="sr-only">Chargement de votre CV…</span>
      <Skeleton className="mx-auto h-[500px] w-full max-w-[420px] rounded-md" />
    </div>
  );
}

function ListSkeleton() {
  return (
    <div className="space-y-3" role="status" aria-busy="true">
      <span className="sr-only">Chargement…</span>
      <Skeleton className="h-20 w-full" />
      <Skeleton className="h-20 w-full" />
    </div>
  );
}

/**
 * « Mon CV » (`/resume`, spec §2, tâche 7) : CV principal dérivé du profil
 * (aperçu, modèle mémorisé, actions), CV adaptés (`ResumeList`) et lettres de
 * motivation (`LetterList`). Les trois sections chargent indépendamment
 * (`useBaseResume`/`useResumes`/`useLetters`) : l'échec d'une n'empêche
 * jamais les deux autres de s'afficher.
 */
export function ResumePage() {
  const baseResumeQuery = useBaseResume();
  const resumesQuery = useResumes();
  const lettersQuery = useLetters();
  const resumeTemplate = useResumeTemplate();
  const [previewOpen, setPreviewOpen] = useState(false);

  return (
    <div className="mx-auto max-w-3xl space-y-10">
      <PageHeader title="Mon CV" description="Votre CV principal, vos CV adaptés et vos lettres." />

      <section className="space-y-4">
        <h2 className="text-lg font-semibold">CV principal</h2>

        {baseResumeQuery.isPending && <BaseResumeSkeleton />}

        {baseResumeQuery.isError && (
          <ErrorState
            message="Impossible de charger votre CV. Réessayez."
            onRetry={() => void baseResumeQuery.refetch()}
            role="status"
          />
        )}

        {baseResumeQuery.isSuccess && (
          <div className="space-y-4">
            {!baseResumeQuery.data.profileComplete && (
              <Alert>
                <AlertCircle aria-hidden="true" />
                <AlertTitle>Complétez votre profil pour un CV exploitable.</AlertTitle>
                <AlertDescription>
                  <Link to="/profile" className="text-primary underline-offset-4 hover:underline">
                    Compléter mon profil
                  </Link>
                </AlertDescription>
              </Alert>
            )}

            <ResumePreview content={baseResumeQuery.data.content} template={baseResumeQuery.data.template} />

            <TemplatePicker
              value={baseResumeQuery.data.template}
              onChange={(template) => resumeTemplate.mutate({ template })}
              disabled={resumeTemplate.isPending}
            />

            <div className="flex flex-wrap gap-2">
              <Button asChild variant="outline">
                <Link to="/profile">
                  <Pencil />
                  Modifier
                </Link>
              </Button>
              <Button type="button" variant="outline" onClick={() => setPreviewOpen(true)}>
                <Eye />
                Prévisualiser
              </Button>
              <DownloadPdfButton
                content={baseResumeQuery.data.content}
                template={baseResumeQuery.data.template}
                fileName={resumeFileName('CV', baseResumeQuery.data.content.identity, null)}
              />
            </div>
          </div>
        )}
      </section>

      <section className="space-y-4">
        <h2 className="text-lg font-semibold">CV adaptés</h2>
        {resumesQuery.isPending && <ListSkeleton />}
        {resumesQuery.isError && (
          <ErrorState
            message="Impossible de charger vos CV adaptés. Réessayez."
            onRetry={() => void resumesQuery.refetch()}
            role="status"
          />
        )}
        {resumesQuery.isSuccess && <ResumeList resumes={resumesQuery.data} />}
      </section>

      <section className="space-y-4">
        <h2 className="text-lg font-semibold">Lettres</h2>
        {lettersQuery.isPending && <ListSkeleton />}
        {lettersQuery.isError && (
          <ErrorState
            message="Impossible de charger vos lettres. Réessayez."
            onRetry={() => void lettersQuery.refetch()}
            role="status"
          />
        )}
        {lettersQuery.isSuccess && <LetterList letters={lettersQuery.data} />}
      </section>

      {baseResumeQuery.isSuccess && (
        <Dialog open={previewOpen} onOpenChange={setPreviewOpen}>
          <DialogContent className="max-h-[90dvh] max-w-4xl overflow-y-auto">
            <DialogHeader>
              <DialogTitle>Aperçu du CV</DialogTitle>
              <DialogDescription className="sr-only">Aperçu en taille réelle de votre CV principal.</DialogDescription>
            </DialogHeader>
            <ResumePreview content={baseResumeQuery.data.content} template={baseResumeQuery.data.template} fit="none" />
          </DialogContent>
        </Dialog>
      )}
    </div>
  );
}
