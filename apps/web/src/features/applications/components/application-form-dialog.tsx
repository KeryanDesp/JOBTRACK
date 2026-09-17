import type {
  ApplicationDetailDto,
  ApplicationSource,
  ApplicationStatus,
  CreateFromJobInput,
  CreateManualInput,
  ResumeSummaryDto,
} from '@jobtrack/shared';
import { APPLICATION_SOURCE_LABELS, APPLICATION_SOURCES, createFromJobSchema, createManualSchema } from '@jobtrack/shared';
import type { FieldValues, Path, UseFormSetError } from 'react-hook-form';
import { useForm } from 'react-hook-form';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Textarea } from '@/components/ui/textarea';
import { FormFieldError } from '@/features/auth/components/form-field-error';
import { applyFieldErrors } from '@/features/auth/lib/form-errors';
import { useLetters, useResumes } from '@/features/resume/hooks/use-resume';
import { emptyToNull, zodResolverWith } from '@/lib/forms';
import { ApiError } from '@/services/api/client';
import { useCreateApplication } from '../hooks/use-applications';
import { ApplicationStatusSelect } from './application-status-select';

/**
 * Sentinelles d'affichage du sélecteur « CV utilisé » : le contrat ne connaît
 * que le couple (`resumeId`, `usedBaseResume`), mais un `Select` a besoin
 * d'une valeur unique par option — et Radix refuse la chaîne vide comme
 * valeur d'option. Ces deux constantes ne quittent jamais le formulaire
 * (`toResumeFields` les retraduit avant l'envoi).
 */
const RESUME_NONE = 'NONE';
const RESUME_BASE = 'BASE';
/** Même principe pour « Aucune lettre ». */
const LETTER_NONE = 'NONE';

/** Offre d'origine (spec §2, parcours « Suivre cette candidature »). */
export interface ApplicationFormJob {
  id: string;
  title: string;
  company: string | null;
  /** CV déjà adaptés à cette offre : proposés en premier dans « CV utilisé ». */
  tailoredResumes: ResumeSummaryDto[];
}

export interface ApplicationFormDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Absent : création manuelle (tous les champs). Présent : formulaire court lié à l'offre. */
  job?: ApplicationFormJob;
  onCreated: (application: ApplicationDetailDto) => void;
  /**
   * Ouvre la fiche d'une candidature. Appelé par l'action « Voir » du toast de
   * succès, et surtout sur un 409 `APPLICATION_EXISTS` (spec §5) : l'offre est
   * déjà suivie, le formulaire se ferme et la fiche existante s'ouvre — jamais
   * de message d'erreur pour ce cas, qui n'en est pas un.
   */
  onOpenApplication: (applicationId: string) => void;
}

/** Traduit la sentinelle du sélecteur de CV vers le couple attendu par le contrat. */
function toResumeFields(choice: string): { resumeId: string | null; usedBaseResume: boolean } {
  if (choice === RESUME_BASE) return { resumeId: null, usedBaseResume: true };
  if (choice === RESUME_NONE) return { resumeId: null, usedBaseResume: false };
  return { resumeId: choice, usedBaseResume: false };
}

/** Le 409 de doublon porte l'identifiant de la candidature existante dans `details` (spec §5). */
function existingApplicationId(error: unknown): string | undefined {
  if (!(error instanceof ApiError) || error.code !== 'APPLICATION_EXISTS') return undefined;
  return error.details?.applicationId;
}

/**
 * Reporte une erreur `VALIDATION_ERROR.details` du contrat sur un champ du
 * formulaire dont le nom diffère du sien — le cas de `resumeId`/`usedBaseResume`
 * (exclusivité vérifiée par `refineCvExclusivity`, `@jobtrack/shared`) et de
 * `coverLetterId` : le contrat les connaît sous ces noms, mais ce formulaire
 * n'a que les sentinelles `resumeChoice`/`letterChoice` (voir plus haut) —
 * `applyFieldErrors` ne peut donc pas les cibler directement, faute de champ
 * de même nom. `serverFields` est parcouru dans l'ordre : le premier qui
 * porte un message gagne.
 */
function applyAliasedFieldError<T extends FieldValues>(
  error: unknown,
  setError: UseFormSetError<T>,
  serverFields: readonly string[],
  formField: Path<T>,
): boolean {
  if (!(error instanceof ApiError) || error.code !== 'VALIDATION_ERROR' || !error.details) return false;

  for (const serverField of serverFields) {
    const message = error.details[serverField];
    if (message) {
      setError(formField, { message });
      return true;
    }
  }
  return false;
}

// ---------------------------------------------------------------------------
// Mode manuel
// ---------------------------------------------------------------------------

interface ManualFormValues {
  jobTitle: string;
  company: string;
  source: ApplicationSource;
  sourceUrl: string;
  locationLabel: string;
  status: ApplicationStatus;
  appliedAt: string;
  resumeChoice: string;
  notes: string;
}

const MANUAL_DEFAULTS: ManualFormValues = {
  jobTitle: '',
  company: '',
  source: 'OTHER',
  sourceUrl: '',
  locationLabel: '',
  status: 'TO_APPLY',
  appliedAt: '',
  resumeChoice: RESUME_NONE,
  notes: '',
};

const MANUAL_ERROR_FIELDS = ['jobTitle', 'company', 'source', 'sourceUrl', 'locationLabel', 'status', 'appliedAt', 'notes'] as const;
/** `resumeId`/`usedBaseResume` (spec §5) : reportés sur `resumeChoice` via `applyAliasedFieldError`. */
const MANUAL_RESUME_ERROR_FIELDS = ['resumeId', 'usedBaseResume'] as const;

/**
 * Valeurs du formulaire manuel dans la forme attendue par `createManualSchema` :
 * sentinelles de CV retraduites, `appliedAt` vide converti en `null` (le
 * schéma n'accepte pas `''` pour une date) et toujours `null` tant que le
 * statut est « À postuler » — le champ est alors masqué, une date restée d'un
 * choix précédent ne doit pas partir au serveur (spec §5 : `appliedAt` est
 * renseigné au premier passage hors de `TO_APPLY`).
 */
function normalizeManual(raw: ManualFormValues): unknown {
  const { resumeChoice, ...rest } = raw;
  const value: Record<string, unknown> = {
    ...rest,
    ...toResumeFields(resumeChoice),
    appliedAt: rest.status === 'TO_APPLY' ? '' : rest.appliedAt,
  };
  return emptyToNull(value, ['appliedAt']);
}

// ---------------------------------------------------------------------------
// Mode « depuis une offre »
// ---------------------------------------------------------------------------

interface JobFormValues {
  status: ApplicationStatus;
  appliedAt: string;
  resumeChoice: string;
  letterChoice: string;
}

const JOB_DEFAULTS: JobFormValues = {
  status: 'TO_APPLY',
  appliedAt: '',
  resumeChoice: RESUME_NONE,
  letterChoice: LETTER_NONE,
};

const JOB_ERROR_FIELDS = ['status', 'appliedAt'] as const;
/** `resumeId`/`usedBaseResume` (spec §5) : reportés sur `resumeChoice` via `applyAliasedFieldError`. */
const JOB_RESUME_ERROR_FIELDS = ['resumeId', 'usedBaseResume'] as const;
/** `coverLetterId` : reporté sur `letterChoice`. `jobId` n'a ici aucun champ à cibler (l'offre
 * est fixée par `job`, pas saisie) — une erreur sur ce champ reste dans le toast générique de
 * `useCreateApplication`. */
const JOB_LETTER_ERROR_FIELDS = ['coverLetterId'] as const;

function normalizeFromJob(raw: JobFormValues, jobId: string): unknown {
  const { resumeChoice, letterChoice, ...rest } = raw;
  const value: Record<string, unknown> = {
    jobId,
    ...rest,
    ...toResumeFields(resumeChoice),
    coverLetterId: letterChoice === LETTER_NONE ? null : letterChoice,
    appliedAt: rest.status === 'TO_APPLY' ? '' : rest.appliedAt,
  };
  return emptyToNull(value, ['appliedAt']);
}

// ---------------------------------------------------------------------------
// Champs partagés par les deux modes
// ---------------------------------------------------------------------------

interface StatusAndDateFieldsProps {
  status: ApplicationStatus;
  appliedAt: string;
  appliedAtError?: string;
  onStatusChange: (status: ApplicationStatus) => void;
  onAppliedAtChange: (value: string) => void;
}

/**
 * Statut + date de candidature. La date n'apparaît qu'une fois le statut sorti
 * de « À postuler » : tant qu'on n'a pas postulé, il n'y a pas de date à
 * saisir (spec §5).
 */
function StatusAndDateFields({
  status,
  appliedAt,
  appliedAtError,
  onStatusChange,
  onAppliedAtChange,
}: StatusAndDateFieldsProps) {
  return (
    <div className="grid gap-4 sm:grid-cols-2">
      <div className="space-y-2">
        <Label htmlFor="application-status">Statut</Label>
        <ApplicationStatusSelect
          id="application-status"
          value={status}
          onChange={onStatusChange}
          ariaLabel="Statut"
          className="w-full"
        />
      </div>

      {status !== 'TO_APPLY' && (
        <div className="space-y-2">
          <Label htmlFor="application-appliedAt">Date de candidature</Label>
          <Input
            id="application-appliedAt"
            type="date"
            value={appliedAt}
            onChange={(event) => onAppliedAtChange(event.target.value)}
            aria-describedby={appliedAtError ? 'application-appliedAt-error' : undefined}
            aria-invalid={appliedAtError ? true : undefined}
          />
          <FormFieldError id="application-appliedAt-error" message={appliedAtError} />
        </div>
      )}
    </div>
  );
}

interface ResumeSelectFieldProps {
  value: string;
  onChange: (value: string) => void;
  /** CV proposés, déjà dans l'ordre voulu par le mode courant. */
  resumes: ResumeSummaryDto[];
  /** « CV principal » et « Aucun » en tête (mode manuel) ou en fin (mode offre). */
  emptyChoicesFirst: boolean;
  /** Message serveur reporté sur `resumeChoice` (`resumeId`/`usedBaseResume`, spec §5) —
   * `applyAliasedFieldError`, faute de champ de même nom que celui du contrat. */
  error?: string;
}

/** Sélecteur « CV utilisé » : « Aucun », « CV principal », puis chaque CV adapté (spec §2). */
function ResumeSelectField({ value, onChange, resumes, emptyChoicesFirst, error }: ResumeSelectFieldProps) {
  const emptyChoices = [
    <SelectItem key={RESUME_NONE} value={RESUME_NONE}>
      Aucun
    </SelectItem>,
    <SelectItem key={RESUME_BASE} value={RESUME_BASE}>
      CV principal
    </SelectItem>,
  ];
  const resumeChoices = resumes.map((resume) => (
    <SelectItem key={resume.id} value={resume.id}>
      {resume.title}
    </SelectItem>
  ));

  return (
    <div className="space-y-2">
      <Label htmlFor="application-resume">CV utilisé</Label>
      <Select value={value} onValueChange={onChange}>
        <SelectTrigger
          id="application-resume"
          aria-label="CV utilisé"
          className="w-full"
          aria-describedby={error ? 'application-resume-error' : undefined}
          aria-invalid={error ? true : undefined}
        >
          <SelectValue />
        </SelectTrigger>
        <SelectContent>{emptyChoicesFirst ? [...emptyChoices, ...resumeChoices] : [...resumeChoices, ...emptyChoices]}</SelectContent>
      </Select>
      <FormFieldError id="application-resume-error" message={error} />
    </div>
  );
}

// ---------------------------------------------------------------------------
// Formulaires
// ---------------------------------------------------------------------------

interface ModeFormProps {
  onCreated: (application: ApplicationDetailDto) => void;
  onOpenApplication: (applicationId: string) => void;
  onClose: () => void;
}

/** Toast de confirmation commun aux deux modes (spec §2 : « Candidature ajoutée » + lien « Voir »). */
function notifyCreated(application: ApplicationDetailDto, onOpenApplication: (id: string) => void): void {
  toast.success('Candidature ajoutée.', {
    action: { label: 'Voir', onClick: () => onOpenApplication(application.id) },
  });
}

function ManualApplicationForm({ onCreated, onOpenApplication, onClose }: ModeFormProps) {
  const resumes = useResumes();
  const createApplication = useCreateApplication();

  const form = useForm<ManualFormValues, unknown, CreateManualInput>({
    resolver: zodResolverWith<ManualFormValues, CreateManualInput>(createManualSchema, (raw) =>
      normalizeManual(raw as ManualFormValues),
    ),
    defaultValues: MANUAL_DEFAULTS,
  });

  const errors = form.formState.errors;
  const status = form.watch('status');

  function onSubmit(values: CreateManualInput): void {
    createApplication.mutate(values, {
      onSuccess: (application) => {
        notifyCreated(application, onOpenApplication);
        onCreated(application);
        onClose();
      },
      // `useCreateApplication` signale déjà l'échec par un toast : on n'ajoute
      // ici que ce qu'il ne peut pas faire — replacer les messages du serveur
      // sur les champs qu'ils concernent.
      onError: (error) => {
        // Un doublon reste possible même ici si l'API venait à en signaler un :
        // le formulaire se ferme et la fiche existante s'ouvre, comme en mode offre.
        const existingId = existingApplicationId(error);
        if (existingId !== undefined) {
          onClose();
          onOpenApplication(existingId);
          return;
        }
        applyFieldErrors<ManualFormValues>(error, form.setError, MANUAL_ERROR_FIELDS);
        applyAliasedFieldError(error, form.setError, MANUAL_RESUME_ERROR_FIELDS, 'resumeChoice');
      },
    });
  }

  return (
    <form onSubmit={(event) => void form.handleSubmit(onSubmit)(event)} noValidate className="space-y-4">
      <div className="space-y-2">
        <Label htmlFor="application-jobTitle">Poste *</Label>
        <Input
          id="application-jobTitle"
          autoComplete="off"
          aria-describedby={errors.jobTitle ? 'application-jobTitle-error' : undefined}
          aria-invalid={errors.jobTitle ? true : undefined}
          {...form.register('jobTitle')}
        />
        <FormFieldError id="application-jobTitle-error" message={errors.jobTitle?.message} />
      </div>

      <div className="grid gap-4 sm:grid-cols-2">
        <div className="space-y-2">
          <Label htmlFor="application-company">Entreprise</Label>
          <Input
            id="application-company"
            autoComplete="off"
            aria-describedby={errors.company ? 'application-company-error' : undefined}
            aria-invalid={errors.company ? true : undefined}
            {...form.register('company')}
          />
          <FormFieldError id="application-company-error" message={errors.company?.message} />
        </div>

        <div className="space-y-2">
          <Label htmlFor="application-source">Source</Label>
          <Select value={form.watch('source')} onValueChange={(next) => form.setValue('source', next as ApplicationSource)}>
            <SelectTrigger id="application-source" aria-label="Source" className="w-full">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {APPLICATION_SOURCES.map((source) => (
                <SelectItem key={source} value={source}>
                  {APPLICATION_SOURCE_LABELS[source]}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      </div>

      <div className="grid gap-4 sm:grid-cols-2">
        <div className="space-y-2">
          <Label htmlFor="application-sourceUrl">Lien de l'offre</Label>
          <Input
            id="application-sourceUrl"
            type="url"
            inputMode="url"
            placeholder="https://"
            aria-describedby={errors.sourceUrl ? 'application-sourceUrl-error' : undefined}
            aria-invalid={errors.sourceUrl ? true : undefined}
            {...form.register('sourceUrl')}
          />
          <FormFieldError id="application-sourceUrl-error" message={errors.sourceUrl?.message} />
        </div>

        <div className="space-y-2">
          <Label htmlFor="application-locationLabel">Lieu</Label>
          <Input
            id="application-locationLabel"
            autoComplete="off"
            aria-describedby={errors.locationLabel ? 'application-locationLabel-error' : undefined}
            aria-invalid={errors.locationLabel ? true : undefined}
            {...form.register('locationLabel')}
          />
          <FormFieldError id="application-locationLabel-error" message={errors.locationLabel?.message} />
        </div>
      </div>

      <StatusAndDateFields
        status={status}
        appliedAt={form.watch('appliedAt')}
        appliedAtError={errors.appliedAt?.message}
        onStatusChange={(next) => form.setValue('status', next)}
        onAppliedAtChange={(next) => form.setValue('appliedAt', next)}
      />

      <ResumeSelectField
        value={form.watch('resumeChoice')}
        onChange={(next) => form.setValue('resumeChoice', next)}
        resumes={resumes.data ?? []}
        emptyChoicesFirst
        error={errors.resumeChoice?.message}
      />

      <div className="space-y-2">
        <Label htmlFor="application-notes">Notes</Label>
        <Textarea
          id="application-notes"
          rows={3}
          aria-describedby={errors.notes ? 'application-notes-error' : undefined}
          aria-invalid={errors.notes ? true : undefined}
          {...form.register('notes')}
        />
        <FormFieldError id="application-notes-error" message={errors.notes?.message} />
      </div>

      <DialogFooter>
        <Button type="button" variant="outline" onClick={onClose}>
          Annuler
        </Button>
        <Button type="submit" disabled={createApplication.isPending}>
          Ajouter
        </Button>
      </DialogFooter>
    </form>
  );
}

function JobApplicationForm({ job, onCreated, onOpenApplication, onClose }: ModeFormProps & { job: ApplicationFormJob }) {
  const letters = useLetters();
  const createApplication = useCreateApplication();

  // `job.tailoredResumes` arrive déjà triés du plus récent au plus ancien
  // (`JobDetailHeader`) : le CV en tête est donc préselectionné plutôt que
  // « Aucun » quand l'offre en a au moins un — le cas le plus fréquent est
  // justement celui d'avoir adapté un CV avant de suivre la candidature.
  // `resumeChoice` reste un champ ordinaire du formulaire : l'utilisateur peut
  // toujours revenir sur « Aucun »/« CV principal » via le sélecteur.
  const form = useForm<JobFormValues, unknown, CreateFromJobInput>({
    resolver: zodResolverWith<JobFormValues, CreateFromJobInput>(createFromJobSchema, (raw) =>
      normalizeFromJob(raw as JobFormValues, job.id),
    ),
    defaultValues: { ...JOB_DEFAULTS, resumeChoice: job.tailoredResumes[0]?.id ?? RESUME_NONE },
  });

  const errors = form.formState.errors;
  const status = form.watch('status');
  // Seules les lettres écrites pour cette offre ont un sens ici (spec §2).
  const jobLetters = (letters.data ?? []).filter((letter) => letter.jobId === job.id);

  function onSubmit(values: CreateFromJobInput): void {
    createApplication.mutate(values, {
      onSuccess: (application) => {
        notifyCreated(application, onOpenApplication);
        onCreated(application);
        onClose();
      },
      onError: (error) => {
        const existingId = existingApplicationId(error);
        if (existingId !== undefined) {
          onClose();
          onOpenApplication(existingId);
          return;
        }
        applyFieldErrors<JobFormValues>(error, form.setError, JOB_ERROR_FIELDS);
        applyAliasedFieldError(error, form.setError, JOB_RESUME_ERROR_FIELDS, 'resumeChoice');
        applyAliasedFieldError(error, form.setError, JOB_LETTER_ERROR_FIELDS, 'letterChoice');
      },
    });
  }

  return (
    <form onSubmit={(event) => void form.handleSubmit(onSubmit)(event)} noValidate className="space-y-4">
      <StatusAndDateFields
        status={status}
        appliedAt={form.watch('appliedAt')}
        appliedAtError={errors.appliedAt?.message}
        onStatusChange={(next) => form.setValue('status', next)}
        onAppliedAtChange={(next) => form.setValue('appliedAt', next)}
      />

      <ResumeSelectField
        value={form.watch('resumeChoice')}
        onChange={(next) => form.setValue('resumeChoice', next)}
        resumes={job.tailoredResumes}
        emptyChoicesFirst={false}
        error={errors.resumeChoice?.message}
      />

      <div className="space-y-2">
        <Label htmlFor="application-letter">Lettre</Label>
        <Select value={form.watch('letterChoice')} onValueChange={(next) => form.setValue('letterChoice', next)}>
          <SelectTrigger
            id="application-letter"
            aria-label="Lettre"
            className="w-full"
            aria-describedby={errors.letterChoice ? 'application-letter-error' : undefined}
            aria-invalid={errors.letterChoice ? true : undefined}
          >
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value={LETTER_NONE}>Aucune</SelectItem>
            {jobLetters.map((letter) => (
              <SelectItem key={letter.id} value={letter.id}>
                {`Lettre du ${new Date(letter.createdAt).toLocaleDateString('fr-FR')}`}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <FormFieldError id="application-letter-error" message={errors.letterChoice?.message} />
      </div>

      <DialogFooter>
        <Button type="button" variant="outline" onClick={onClose}>
          Annuler
        </Button>
        <Button type="submit" disabled={createApplication.isPending}>
          Suivre cette candidature
        </Button>
      </DialogFooter>
    </form>
  );
}

/**
 * Création d'une candidature (spec §2/§4) : manuelle depuis `/applications`,
 * ou courte depuis une offre (`job` fourni). Le contenu n'est monté qu'à
 * l'ouverture (`Dialog` sans `forceMount`) : chaque ouverture repart donc de
 * champs vierges, sans `reset` explicite à maintenir.
 */
export function ApplicationFormDialog({ open, onOpenChange, job, onCreated, onOpenApplication }: ApplicationFormDialogProps) {
  const close = () => onOpenChange(false);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[90dvh] overflow-y-auto sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>{job ? 'Suivre cette candidature' : 'Ajouter une candidature'}</DialogTitle>
          <DialogDescription>
            {job
              ? `${job.title}${job.company ? ` · ${job.company}` : ''}`
              : 'Pour une candidature envoyée en dehors de JobTrack.'}
          </DialogDescription>
        </DialogHeader>

        {job ? (
          <JobApplicationForm
            job={job}
            onCreated={onCreated}
            onOpenApplication={onOpenApplication}
            onClose={close}
          />
        ) : (
          <ManualApplicationForm onCreated={onCreated} onOpenApplication={onOpenApplication} onClose={close} />
        )}
      </DialogContent>
    </Dialog>
  );
}
