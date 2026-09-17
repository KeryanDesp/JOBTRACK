import type { CoverLetterContent, CoverLetterDto, CoverLetterTone } from '@jobtrack/shared';
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
import { LetterErrorAlert } from '../components/letter-error-alert';
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
  const deleteLetter = useDeleteLetter();

  const [tone, setTone] = useState<CoverLetterTone>(DEFAULT_TONE);
  const [confirmDeleteOpen, setConfirmDeleteOpen] = useState(false);

  if (jobQuery.isPending || baseResumeQuery.isPending) return <PageSkeleton />;

  if (jobQuery.isError) {
    return (
      <div className="mx-auto max-w-5xl">
        <NotFoundOrError
          error={jobQuery.error}
          onRetry={() => void jobQuery.refetch()}
          notFoundMessage="Offre introuvable."
          backHref="/resume"
          backLabel="Retour à Mon CV"
          fallbackMessage="Impossible de charger l'offre. Réessayez."
        />
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
        <NotFoundOrError
          error={letterQuery.error}
          onRetry={() => void letterQuery.refetch()}
          notFoundMessage="Lettre introuvable."
          backHref="/resume"
          backLabel="Retour à Mon CV"
          fallbackMessage="Impossible de charger cette lettre. Réessayez."
        />
      )}

      {letterId !== '' && letterQuery.data && (
        <LetterWorkspace
          key={letterQuery.data.id}
          letter={letterQuery.data}
          jobId={jobId}
          company={job.company}
          senderName={senderName}
          senderCity={senderCity}
          dateLine={dateLine}
          fileName={resumeFileName('Lettre', baseResume.content.identity, job.company)}
          onDeleteClick={() => setConfirmDeleteOpen(true)}
        />
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

interface LetterWorkspaceProps {
  letter: CoverLetterDto;
  jobId: string;
  company: string | null;
  senderName: string;
  senderCity: string | null;
  dateLine: string;
  fileName: string;
  onDeleteClick: () => void;
}

/**
 * Éditeur, aperçu, téléchargement et régénération d'une lettre déjà générée
 * (spec §2/§4/§5/§7, tâche 8, revue) — remonté par le composant appelant via
 * `key={letter.id}` à chaque changement de lettre (nouvelle lettre régénérée,
 * navigation directe entre deux lettres). Ce remontage réinitialise
 * naturellement `liveContent` (aperçu en temps réel) et `regenerateTone`
 * (initialisé sur le ton de *cette* lettre) sans effet dédié ni flash de
 * contenu obsolète : `letterQuery.data` de la nouvelle lettre est déjà en
 * cache (posé par `useCreateLetter`/`useLetter`) au moment du remontage.
 */
function LetterWorkspace({ letter, jobId, company, senderName, senderCity, dateLine, fileName, onDeleteClick }: LetterWorkspaceProps) {
  const navigate = useNavigate();
  const updateLetter = useUpdateLetter(letter.id);
  const createLetter = useCreateLetter();

  const [liveContent, setLiveContent] = useState<CoverLetterContent | null>(null);
  const [regenerateTone, setRegenerateTone] = useState<CoverLetterTone>(letter.tone);
  const [confirmRegenerateOpen, setConfirmRegenerateOpen] = useState(false);

  const displayContent = liveContent ?? letter.content;

  function handleConfirmRegenerate(): void {
    setConfirmRegenerateOpen(false);
    createLetter.mutate(
      { jobId, tone: regenerateTone },
      { onSuccess: (created) => navigate(`?lettre=${created.id}`, { replace: true }) },
    );
  }

  return (
    <>
      <div className="grid gap-6 lg:grid-cols-2">
        <CoverLetterEditor
          key={letter.updatedAt}
          content={letter.content}
          tone={letter.tone}
          onChange={setLiveContent}
          onSave={(content) => updateLetter.mutate({ content })}
          isSaving={updateLetter.isPending}
        />
        <LetterPreview content={displayContent} senderName={senderName} senderCity={senderCity} company={company} dateLine={dateLine} />
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <DownloadLetterPdfButton content={displayContent} senderName={senderName} senderCity={senderCity} company={company} dateLine={dateLine} fileName={fileName} />
        <Button type="button" variant="outline" onClick={onDeleteClick}>
          Supprimer
        </Button>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Régénérer avec un autre ton</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <LetterErrorAlert error={createLetter.error} />
          <TonePicker value={regenerateTone} onChange={setRegenerateTone} disabled={createLetter.isPending} />
          <Button type="button" variant="outline" onClick={() => setConfirmRegenerateOpen(true)} disabled={createLetter.isPending}>
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

      <Dialog open={confirmRegenerateOpen} onOpenChange={setConfirmRegenerateOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Régénérer la lettre ?</DialogTitle>
            <DialogDescription>Une nouvelle lettre sera créée. Celle-ci est conservée dans Mon CV.</DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => setConfirmRegenerateOpen(false)}>
              Annuler
            </Button>
            <Button type="button" onClick={handleConfirmRegenerate}>
              Régénérer
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
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
 * Bloc de génération (spec §2/§5, tâche 8) : profil incomplet remplace
 * entièrement le choix de ton (il n'y a rien à retenter avant d'aller
 * compléter le profil). Toute autre erreur — y compris IA non configurée,
 * profil jugé incomplet côté serveur ou budget épuisé (revue tâche 8 fixup :
 * ces trois codes remplaçaient auparavant tout le panneau, empêchant de
 * retenter ou de revenir en arrière) — reste transitoire ou nécessite une
 * action que ce panneau permet toujours : il reste affiché, avec le message
 * d'erreur (`LetterErrorAlert`, partagé avec la carte « Régénérer », revue)
 * au-dessus, le bouton réactivé pour retenter (désactivé seulement pendant la
 * génération), et un lien secondaire pour revenir à Mon CV.
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

  return (
    <Card>
      <CardHeader>
        <CardTitle>Choisissez un ton</CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        <LetterErrorAlert error={error} />
        <TonePicker value={tone} onChange={onToneChange} disabled={isGenerating} />
        <div className="flex flex-wrap items-center gap-4">
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
          <Link to="/resume" className="text-sm font-medium text-primary underline-offset-4 hover:underline">
            Retour à Mon CV
          </Link>
        </div>
      </CardContent>
    </Card>
  );
}

interface NotFoundOrErrorProps {
  error: unknown;
  onRetry: () => void;
  /** Affiché à la place d'`ErrorState` (sans « Réessayer », inutile pour un 404) quand `error` en est un. */
  notFoundMessage: string;
  backHref: string;
  backLabel: string;
  /** Message générique d'`ErrorState` si `error` ne porte pas de message lisible (pas un `ApiError`). */
  fallbackMessage: string;
}

/** 404 (message dédié, lien de retour, sans « Réessayer ») ou toute autre erreur (message + « Réessayer »). */
function NotFoundOrError({ error, onRetry, notFoundMessage, backHref, backLabel, fallbackMessage }: NotFoundOrErrorProps) {
  const notFound = error instanceof ApiError && error.status === 404;
  if (notFound) {
    return (
      <div className="space-y-4 py-16 text-center">
        <p className="text-base font-medium">{notFoundMessage}</p>
        <Link to={backHref} className="text-sm font-medium text-primary underline-offset-4 hover:underline">
          {backLabel}
        </Link>
      </div>
    );
  }
  return <ErrorState message={errorMessage(error, fallbackMessage)} onRetry={onRetry} />;
}
