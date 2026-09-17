import { useEffect, useRef, useState } from 'react';
import type { ApplicationDetailDto, UpdateApplicationInput } from '@jobtrack/shared';
import { ExternalLink } from 'lucide-react';
import { Link } from 'react-router-dom';
import { ErrorState } from '@/components/shared/error-state';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Separator } from '@/components/ui/separator';
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from '@/components/ui/sheet';
import { Skeleton } from '@/components/ui/skeleton';
import { Textarea } from '@/components/ui/textarea';
import { isHttpUrl } from '@/features/jobs/lib/format';
import { useLetters, useResumes } from '@/features/resume/hooks/use-resume';
import { ApiError } from '@/services/api/client';
import { useApplication, useUpdateApplication } from '../hooks/use-applications';
import { sourceLabel } from '../lib/format';
import { ApplicationEvents } from './application-events';
import { ApplicationStatusSelect } from './application-status-select';
import { DeleteApplicationButton } from './delete-application-button';

// Valeurs réservées du sélecteur « CV utilisé » : aucun identifiant de CV ne
// peut les prendre (ce sont des `cuid`), elles restent donc distinguables.
const NO_RESUME = 'aucun';
const BASE_RESUME = 'principal';

/** Durée d'affichage de la confirmation « Enregistré » (spec §7). */
const SAVED_NOTICE_MS = 2000;

interface ApplicationSheetProps {
  id: string | null;
  onClose: () => void;
}

/**
 * Panneau de détail d'une candidature (spec §2, point 5 ; `?candidature=<id>`
 * côté page). Chaque champ (statut, date, CV) est enregistré dès sa
 * modification via `useUpdateApplication` (optimiste) ; seules les notes ont
 * une sauvegarde explicite, un texte libre n'ayant pas de « fin de saisie »
 * détectable.
 */
export function ApplicationSheet({ id, onClose }: ApplicationSheetProps) {
  return (
    <Sheet
      open={id !== null}
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
    >
      {/* `sm:max-w-none` est indispensable : `tailwind-merge` ne considère pas
          `max-w-none` et `sm:max-w-sm` comme concurrents (variantes
          différentes), et le `sm:max-w-sm` du primitif rétrécirait sinon le
          panneau entre 640 et 767 px, où il doit encore occuper tout l'écran. */}
      <SheetContent
        side="right"
        className="w-full max-w-none gap-0 overflow-y-auto sm:max-w-none md:w-[30rem] md:max-w-[30rem]"
      >
        {/* `key` : changer de candidature sans fermer le panneau doit repartir
            d'un brouillon de notes vierge, pas de celui de la précédente. */}
        {id === null ? null : <ApplicationSheetBody key={id} id={id} onClose={onClose} />}
      </SheetContent>
    </Sheet>
  );
}

function ApplicationSheetBody({ id, onClose }: { id: string; onClose: () => void }) {
  const { data, isPending, isError, error, refetch } = useApplication(id);

  if (isPending) {
    return (
      <>
        <SheetHeader>
          <SheetTitle>Candidature</SheetTitle>
          <SheetDescription>Chargement…</SheetDescription>
        </SheetHeader>
        <div className="space-y-3 p-4">
          <Skeleton className="h-9 w-full" />
          <Skeleton className="h-9 w-full" />
          <Skeleton className="h-24 w-full" />
        </div>
      </>
    );
  }

  if (isError || data === undefined) {
    const notFound = error instanceof ApiError && error.status === 404;
    return (
      <>
        <SheetHeader>
          <SheetTitle>Candidature</SheetTitle>
          <SheetDescription>
            {notFound ? "Cette candidature n'existe plus." : 'Le détail est momentanément indisponible.'}
          </SheetDescription>
        </SheetHeader>
        {notFound ? (
          <div role="status" className="p-4">
            <p className="text-sm">Candidature introuvable.</p>
            <Button variant="outline" className="mt-4" onClick={onClose}>
              Fermer
            </Button>
          </div>
        ) : (
          <ErrorState
            role="status"
            message="La candidature n'a pas pu être chargée."
            onRetry={() => void refetch()}
          />
        )}
      </>
    );
  }

  return <ApplicationSheetContent application={data} onClose={onClose} />;
}

function ApplicationSheetContent({
  application,
  onClose,
}: {
  application: ApplicationDetailDto;
  onClose: () => void;
}) {
  const update = useUpdateApplication();
  const resumes = useResumes();
  const letters = useLetters();

  const [notes, setNotes] = useState(application.notes ?? '');
  const [saved, setSaved] = useState(false);
  const savedTimerRef = useRef<ReturnType<typeof setTimeout>>(undefined);

  // Le minuteur en cours est annulé au démontage : refermer le panneau pendant
  // les deux secondes écrirait sinon dans un composant déjà parti.
  useEffect(() => () => clearTimeout(savedTimerRef.current), []);

  const notesDirty = notes !== (application.notes ?? '');

  function save(input: UpdateApplicationInput): void {
    setSaved(false);
    update.mutate(
      { id: application.id, input },
      {
        onSuccess: () => {
          setSaved(true);
          // « Enregistré » est une confirmation ponctuelle, pas un état : le
          // laisser affiché ferait croire que la modification suivante n'a pas
          // encore été prise, faute de changement visible.
          clearTimeout(savedTimerRef.current);
          savedTimerRef.current = setTimeout(() => setSaved(false), SAVED_NOTICE_MS);
        },
      },
    );
  }

  function handleResumeChange(value: string): void {
    if (value === NO_RESUME) save({ resumeId: null, usedBaseResume: false });
    else if (value === BASE_RESUME) save({ resumeId: null, usedBaseResume: true });
    else save({ resumeId: value, usedBaseResume: false });
  }

  const resumeValue =
    application.resumeId ?? (application.usedBaseResume ? BASE_RESUME : NO_RESUME);

  // La lettre porte elle-même l'offre pour laquelle elle a été écrite : la
  // page `/resume/letter/:jobId` en a besoin, et la candidature a pu perdre
  // son `jobId` (offre purgée, spec §5) sans que la lettre disparaisse.
  const letter =
    application.coverLetterId === null
      ? null
      : ((letters.data ?? []).find((item) => item.id === application.coverLetterId) ?? null);
  const letterJobId = letter?.jobId ?? application.jobId;

  return (
    <>
      <SheetHeader>
        <SheetTitle>{application.jobTitle}</SheetTitle>
        <SheetDescription>{application.company ?? 'Entreprise non précisée'}</SheetDescription>
        {application.job !== null && application.jobId !== null && (
          <Link to={`/jobs/${application.jobId}`} className="text-primary text-sm underline-offset-4 hover:underline">
            Voir l'offre
          </Link>
        )}
      </SheetHeader>

      <div className="space-y-5 px-4 pb-6">
        <div className="space-y-2">
          <Label htmlFor="candidature-statut">Statut</Label>
          <ApplicationStatusSelect
            id="candidature-statut"
            ariaLabel="Statut"
            value={application.status}
            onChange={(status) => save({ status })}
          />
        </div>

        <div className="space-y-2">
          <Label htmlFor="candidature-date">Date de candidature</Label>
          <Input
            id="candidature-date"
            type="date"
            value={application.appliedAt ?? ''}
            // Un `input[type=date]` émet aussi des valeurs intermédiaires vides
            // (saisie clavier en cours, effacement partiel) : sans cette garde,
            // chacune déclencherait un `PATCH` qui remettrait la date à `null`.
            onChange={(event) => {
              const next = event.target.value === '' ? null : event.target.value;
              if (next === application.appliedAt) return;
              save({ appliedAt: next });
            }}
          />
        </div>

        <div className="space-y-2">
          <Label htmlFor="candidature-cv">CV utilisé</Label>
          <Select value={resumeValue} onValueChange={handleResumeChange}>
            <SelectTrigger id="candidature-cv" aria-label="CV utilisé" className="w-full">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value={NO_RESUME}>Aucun</SelectItem>
              <SelectItem value={BASE_RESUME}>CV principal</SelectItem>
              {(resumes.data ?? []).map((resume) => (
                <SelectItem key={resume.id} value={resume.id}>
                  {resume.title}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        <p aria-live="polite" className="text-muted-foreground min-h-4 text-xs">
          {saved ? 'Enregistré' : ''}
        </p>

        <Separator />

        <dl className="space-y-3 text-sm">
          <div className="flex items-baseline justify-between gap-4">
            <dt className="text-muted-foreground">Lettre</dt>
            <dd>
              {application.coverLetterId !== null && letterJobId !== null ? (
                <Link
                  to={`/resume/letter/${letterJobId}?lettre=${application.coverLetterId}`}
                  className="text-primary underline-offset-4 hover:underline"
                >
                  Voir la lettre
                </Link>
              ) : (
                '—'
              )}
            </dd>
          </div>
          <div className="flex items-baseline justify-between gap-4">
            <dt className="text-muted-foreground">Source</dt>
            <dd className="flex items-center gap-2">
              <span>{sourceLabel(application)}</span>
              {isHttpUrl(application.sourceUrl) && (
                <a
                  href={application.sourceUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-primary inline-flex items-center gap-1 underline-offset-4 hover:underline"
                >
                  Ouvrir
                  <ExternalLink className="size-3" aria-hidden="true" />
                </a>
              )}
            </dd>
          </div>
        </dl>

        <Separator />

        <div className="space-y-2">
          <Label htmlFor="candidature-notes">Notes</Label>
          <Textarea
            id="candidature-notes"
            value={notes}
            rows={4}
            onChange={(event) => setNotes(event.target.value)}
          />
          <Button
            variant="outline"
            size="sm"
            disabled={!notesDirty}
            onClick={() => save({ notes: notes === '' ? null : notes })}
          >
            Enregistrer les notes
          </Button>
        </div>

        <Separator />

        <section aria-labelledby="candidature-historique" className="space-y-3">
          <h3 id="candidature-historique" className="text-sm font-semibold">
            Historique
          </h3>
          <ApplicationEvents events={application.events} />
        </section>

        <Separator />

        <DeleteApplicationButton id={application.id} jobId={application.jobId} onDeleted={onClose} />
      </div>
    </>
  );
}
