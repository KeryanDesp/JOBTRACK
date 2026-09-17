import type { CoverLetterContent, CoverLetterTone } from '@jobtrack/shared';
import { resumeFileName } from '@jobtrack/shared';
import { AlertCircle, Loader2 } from 'lucide-react';
import { useState } from 'react';
import { Link, useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { ErrorState } from '@/components/shared/error-state';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Skeleton } from '@/components/ui/skeleton';
import { useJob } from '@/features/jobs/hooks/use-jobs';
import { ApiError } from '@/services/api/client';
import { CoverLetterEditor } from '../components/cover-letter-editor';
import { DownloadLetterPdfButton } from '../components/download-letter-pdf-button';
import { LetterPreview } from '../components/letter-preview';
import { TonePicker } from '../components/tone-picker';
import { useBaseResume, useCreateLetter, useDeleteLetter, useLetter, useUpdateLetter } from '../hooks/use-resume';
import { formatLetterDateLine } from '../lib/letter-templates';

const DEFAULT_TONE: CoverLetterTone = 'PROFESSIONAL';

function PageSkeleton() {
  return (
    <div className="mx-auto max-w-5xl space-y-6" role="status" aria-busy="true">
      <span className="sr-only">Chargement…</span>
      <Skeleton className="h-8 w-2/3" />
      <Skeleton className="h-40 w-full" />
    </div>
  );
}

/** Message lisible si `error` en porte un (`ApiError`), générique sinon. */
function errorMessage(error: unknown, fallback: string): string {
  return error instanceof ApiError ? error.message : fallback;
}

/**
 * Lettre de motivation (`/resume/letter/:jobId`, spec §2/§4/§5/§7, tâche 8) :
 * sans `?lettre=<id>`, choix du ton puis génération par l'IA ; avec, édition
 * du contenu généré (aperçu A4 en temps réel), enregistrement, téléchargement
 * du PDF, suppression, régénération dans un autre ton (nouvelle lettre). La
 * lettre n'a pas d'état « sans IA » comme le CV principal — sans génération,
 * il n'y a rien à éditer (spec §2 point 5) : les codes `AI_NOT_CONFIGURED`,
 * `PROFILE_INCOMPLETE`, `RATE_LIMITED` remplacent alors le formulaire de
 * génération par leur propre état plutôt que de l'y superposer.
 */
export function CoverLetterPage() {
  const params = useParams<{ jobId: string }>();
  const jobId = params.jobId ?? '';
  const [searchParams] = useSearchParams();
  const letterId = searchParams.get('lettre') ?? '';
  const navigate = useNavigate();

  const jobQuery = useJob(jobId);
  const baseResumeQuery = useBaseResume();
  const letterQuery = useLetter(letterId);
  const createLetter = useCreateLetter();
  const updateLetter = useUpdateLetter(letterId);
  const deleteLetter = useDeleteLetter();

  const [tone, setTone] = useState<CoverLetterTone>(DEFAULT_TONE);
  const [regenerateTone, setRegenerateTone] = useState<CoverLetterTone>(DEFAULT_TONE);
  const [liveContent, setLiveContent] = useState<CoverLetterContent | null>(null);
  const [confirmDeleteOpen, setConfirmDeleteOpen] = useState(false);

  if (jobQuery.isPending || baseResumeQuery.isPending) return <PageSkeleton />;

  if (jobQuery.isError) {
    return (
      <div className="mx-auto max-w-5xl">
        <ErrorState message={errorMessage(jobQuery.error, "Impossible de charger l'offre. Réessayez.")} onRetry={() => void jobQuery.refetch()} />
      </div>
    );
  }

  if (baseResumeQuery.isError) {
    return (
      <div className="mx-auto max-w-5xl">
        <ErrorState message={errorMessage(baseResumeQuery.error, 'Impossible de charger votre profil. Réessayez.')} onRetry={() => void baseResumeQuery.refetch()} />
      </div>
    );
  }

  const job = jobQuery.data;
  const baseResume = baseResumeQuery.data;
  const senderName = `${baseResume.content.identity.firstName} ${baseResume.content.identity.lastName}`.trim();
  const senderCity = baseResume.content.identity.city ?? null;
  const dateLine = formatLetterDateLine(senderCity);

  function handleGenerate(selectedTone: CoverLetterTone): void {
    createLetter.mutate(
      { jobId, tone: selectedTone },
      { onSuccess: (created) => navigate(`?lettre=${created.id}`, { replace: true }) },
    );
  }

  function handleConfirmDelete(): void {
    setConfirmDeleteOpen(false);
    if (!letterId) return;
    deleteLetter.mutate(letterId, { onSuccess: () => navigate('/resume') });
  }

  return (
    <div className="mx-auto max-w-5xl space-y-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Lettre de motivation</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          {job.title} — {job.company ?? 'Entreprise non précisée'}
        </p>
      </div>

      {letterId === '' && (
        <GenerationPanel
          profileComplete={baseResume.profileComplete}
          tone={tone}
          onToneChange={setTone}
          onGenerate={() => handleGenerate(tone)}
          isGenerating={createLetter.isPending}
          error={createLetter.error}
        />
      )}

      {letterId !== '' && letterQuery.isPending && <PageSkeleton />}

      {letterId !== '' && letterQuery.isError && (
        <NotFoundOrError error={letterQuery.error} onRetry={() => void letterQuery.refetch()} />
      )}

      {letterId !== '' && letterQuery.data && (
        <>
          <div className="grid gap-6 lg:grid-cols-2">
            <CoverLetterEditor
              key={`${letterQuery.data.id}-${letterQuery.data.updatedAt}`}
              content={letterQuery.data.content}
              tone={letterQuery.data.tone}
              onChange={setLiveContent}
              onSave={(content) => updateLetter.mutate({ content })}
              isSaving={updateLetter.isPending}
            />
            <LetterPreview
              content={liveContent ?? letterQuery.data.content}
              senderName={senderName}
              senderCity={senderCity}
              company={job.company}
              dateLine={dateLine}
            />
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <DownloadLetterPdfButton
              content={liveContent ?? letterQuery.data.content}
              senderName={senderName}
              senderCity={senderCity}
              company={job.company}
              dateLine={dateLine}
              fileName={resumeFileName('Lettre', baseResume.content.identity, job.company)}
            />
            <Button type="button" variant="outline" onClick={() => setConfirmDeleteOpen(true)}>
              Supprimer
            </Button>
          </div>

          <Card>
            <CardHeader>
              <CardTitle>Régénérer avec un autre ton</CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <TonePicker value={regenerateTone} onChange={setRegenerateTone} disabled={createLetter.isPending} />
              <Button type="button" variant="outline" onClick={() => handleGenerate(regenerateTone)} disabled={createLetter.isPending}>
                {createLetter.isPending ? (
                  <>
                    <Loader2 className="animate-spin" aria-hidden="true" />
                    Régénération…
                  </>
                ) : (
                  'Régénérer'
                )}
              </Button>
            </CardContent>
          </Card>
        </>
      )}

      <Dialog open={confirmDeleteOpen} onOpenChange={setConfirmDeleteOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Supprimer cette lettre ?</DialogTitle>
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

interface GenerationPanelProps {
  profileComplete: boolean;
  tone: CoverLetterTone;
  onToneChange: (tone: CoverLetterTone) => void;
  onGenerate: () => void;
  isGenerating: boolean;
  error: unknown;
}

/**
 * Bloc de génération (spec §2/§5, tâche 8) : profil incomplet, IA non
 * configurée et budget épuisé remplacent entièrement le choix de ton — aucun
 * de ces trois états n'a de sens à retenter immédiatement (le premier
 * nécessite d'aller compléter le profil, les deux autres sont hors du
 * contrôle de l'utilisateur dans l'instant). Toute autre erreur reste
 * transitoire : le bloc de génération reste affiché, avec le message d'erreur
 * au-dessus.
 */
function GenerationPanel({ profileComplete, tone, onToneChange, onGenerate, isGenerating, error }: GenerationPanelProps) {
  if (!profileComplete) {
    return (
      <Alert>
        <AlertCircle aria-hidden="true" />
        <AlertTitle>Complétez votre profil pour générer une lettre.</AlertTitle>
        <AlertDescription>
          <Link to="/profile" className="text-primary underline-offset-4 hover:underline">
            Compléter mon profil
          </Link>
        </AlertDescription>
      </Alert>
    );
  }

  const code = error instanceof ApiError ? error.code : undefined;

  if (code === 'AI_NOT_CONFIGURED') {
    return (
      <Alert>
        <AlertCircle aria-hidden="true" />
        <AlertTitle>Le service IA n&apos;est pas configuré.</AlertTitle>
      </Alert>
    );
  }

  if (code === 'PROFILE_INCOMPLETE') {
    return (
      <Alert>
        <AlertCircle aria-hidden="true" />
        <AlertTitle>Complétez votre profil pour générer une lettre.</AlertTitle>
        <AlertDescription>
          <Link to="/profile" className="text-primary underline-offset-4 hover:underline">
            Compléter mon profil
          </Link>
        </AlertDescription>
      </Alert>
    );
  }

  if (code === 'RATE_LIMITED') {
    return (
      <Alert variant="destructive">
        <AlertCircle aria-hidden="true" />
        <AlertTitle>{error instanceof ApiError ? error.message : 'Trop de générations récentes. Réessayez plus tard.'}</AlertTitle>
      </Alert>
    );
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>Choisissez un ton</CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        {error !== undefined && error !== null && (
          <Alert variant="destructive">
            <AlertCircle aria-hidden="true" />
            <AlertTitle>{error instanceof ApiError ? error.message : 'Une erreur est survenue. Veuillez réessayer.'}</AlertTitle>
          </Alert>
        )}
        <TonePicker value={tone} onChange={onToneChange} disabled={isGenerating} />
        <Button type="button" onClick={onGenerate} disabled={isGenerating}>
          {isGenerating ? (
            <>
              <Loader2 className="animate-spin" aria-hidden="true" />
              Génération…
            </>
          ) : (
            'Générer la lettre'
          )}
        </Button>
      </CardContent>
    </Card>
  );
}

/** 404 (« lettre introuvable », lien de retour) ou toute autre erreur (message + « Réessayer »). */
function NotFoundOrError({ error, onRetry }: { error: unknown; onRetry: () => void }) {
  const notFound = error instanceof ApiError && error.status === 404;
  if (notFound) {
    return (
      <div className="space-y-4 py-16 text-center">
        <p className="text-base font-medium">Lettre introuvable.</p>
        <Link to="/resume" className="text-sm font-medium text-primary underline-offset-4 hover:underline">
          Retour à Mon CV
        </Link>
      </div>
    );
  }
  return <ErrorState message={errorMessage(error, 'Impossible de charger cette lettre. Réessayez.')} onRetry={onRetry} />;
}
