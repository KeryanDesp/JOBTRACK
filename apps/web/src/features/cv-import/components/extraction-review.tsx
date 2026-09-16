import {
  certificationSchema,
  educationSchema,
  experienceSchema,
  languageSchema,
  projectSchema,
  skillSchema,
  type CertificationFormInput,
  type CvApplyFormInput,
  type CvExtraction,
  type EducationFormInput,
  type ExperienceFormInput,
  type LanguageFormInput,
  type ProjectFormInput,
  type SkillFormInput,
} from '@jobtrack/shared';
import {
  AlertCircle,
  Award,
  Briefcase,
  FolderGit2,
  GraduationCap,
  Inbox,
  Languages as LanguagesIcon,
  Sparkles,
  X,
} from 'lucide-react';
import { useEffect, useRef, useState, type Dispatch, type SetStateAction } from 'react';
import type { ZodType, ZodTypeDef } from 'zod';
import { EmptyState } from '@/components/shared/empty-state';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { ServerErrorAlert } from '@/features/auth/components/server-error-alert';
import { topLevelMessage } from '@/features/auth/lib/form-errors';
import {
  CertificationFields,
  normalize as normalizeCertification,
  toFormValues as certificationToFormValues,
} from '@/features/profile/sections/certifications-section';
import {
  EducationFields,
  normalize as normalizeEducation,
  toFormValues as educationToFormValues,
} from '@/features/profile/sections/educations-section';
import {
  ExperienceFields,
  normalize as normalizeExperience,
  toFormValues as experienceToFormValues,
} from '@/features/profile/sections/experiences-section';
import { LanguageFields, toFormValues as languageToFormValues } from '@/features/profile/sections/languages-section';
import {
  ProjectFields,
  normalize as normalizeProject,
  toFormValues as projectToFormValues,
} from '@/features/profile/sections/projects-section';
import { SkillFields, toFormValues as skillToFormValues } from '@/features/profile/sections/skills-section';
import { formatMonthYear } from '@/lib/dates';
import { ApiError } from '@/services/api/client';
import { ReviewBlock, type ReviewRow } from './review-block';

export interface ExtractionReviewProps {
  extraction: CvExtraction;
  onSubmit: (body: CvApplyFormInput) => void;
  isPending: boolean;
  error: unknown;
  /** « Choisir un autre fichier » (extraction vide) : revient à la sélection d'un CV. */
  onBack: () => void;
  /** « Continuer sans importer » : rien n'est appliqué, mais l'étape est considérée franchie. */
  onSkip: () => void;
}

interface IdentityState {
  firstName: string;
  lastName: string;
  phone: string;
  city: string;
  country: string;
  title: string;
  summary: string;
}

interface PreferencesState {
  desiredRoles: string[];
  locations: string[];
}

/** Un identifiant de ligne envoyée par bloc, dans l'ordre du corps de la dernière tentative — pour retrouver la ligne visée par une erreur serveur `<bloc>.<index>.item.<champ>` (l'index y désigne une position dans la liste envoyée, jamais dans `rows`). */
interface SentRowIds {
  experiences: string[];
  educations: string[];
  skills: string[];
  languages: string[];
  certifications: string[];
  projects: string[];
}

const EMPTY_SENT_ROW_IDS: SentRowIds = {
  experiences: [],
  educations: [],
  skills: [],
  languages: [],
  certifications: [],
  projects: [],
};

const VALIDATION_ALERT_MESSAGE = 'Corrigez les éléments signalés ou décochez-les.';

function toIdentityState(identity: CvExtraction['identity']): IdentityState {
  return {
    firstName: identity.firstName ?? '',
    lastName: identity.lastName ?? '',
    phone: identity.phone ?? '',
    city: identity.city ?? '',
    country: identity.country ?? '',
    title: identity.title ?? '',
    summary: identity.summary ?? '',
  };
}

/** `''` (champ vidé par l'utilisateur) → clé omise à l'envoi (`JSON.stringify` retire les clés `undefined`), jamais transmise comme une valeur à effacer. */
function presentOrUndefined(value: string): string | undefined {
  const trimmed = value.trim();
  return trimmed === '' ? undefined : trimmed;
}

/**
 * Initialise les lignes cochables d'un bloc à partir des brouillons extraits :
 * chaque élément part sélectionné et sans erreur, avec un identifiant stable
 * (`<blockKey>-<index>`, jamais recalculé ensuite) qui sert de cible de
 * focus/défilement et de clé de correspondance avec les erreurs serveur.
 * `toFormValues` (exportée par la section de profil correspondante) attend un
 * `CollectionItem` complet — `id` et `sortOrder` n'y sont jamais lus, on les
 * complète ici par une valeur muette plutôt que dupliquer la conversion.
 */
function initRows<TDraft extends object, TValues>(
  blockKey: string,
  drafts: readonly TDraft[],
  toFormValues: (item: TDraft & { id: string; sortOrder: number }) => TValues,
): ReviewRow<TValues>[] {
  return drafts.map((draft, index) => ({
    id: `${blockKey}-${index}`,
    selected: true,
    values: toFormValues({ ...draft, id: '', sortOrder: 0 }),
  }));
}

function countSelected(rows: readonly ReviewRow<unknown>[]): number {
  return rows.filter((row) => row.selected).length;
}

function footerMessage(total: number): string {
  if (total === 0) return '0 élément ne sera ajouté à votre profil.';
  if (total === 1) return '1 élément sera ajouté à votre profil.';
  return `${total} éléments seront ajoutés à votre profil.`;
}

/**
 * Valide, avant tout envoi, les lignes sélectionnées d'un bloc avec son
 * schéma strict — le même que celui appliqué côté serveur — après la même
 * normalisation que celle utilisée pour construire le corps de la requête.
 * Une ligne décochée n'est jamais validée (elle ne sera pas envoyée) et perd
 * toute erreur laissée par une tentative précédente ; une ligne valide perd
 * aussi la sienne. Renvoie les lignes mises à jour et l'identifiant de la
 * première ligne invalide rencontrée (`null` si tout est valide).
 */
function validateSelectedRows<TValues, TOutput>(
  rows: ReviewRow<TValues>[],
  schema: ZodType<TOutput, ZodTypeDef, unknown>,
  normalize: (raw: TValues) => unknown,
): { rows: ReviewRow<TValues>[]; firstInvalidId: string | null } {
  let firstInvalidId: string | null = null;
  const nextRows = rows.map((row) => {
    if (!row.selected) return row.error === undefined ? row : { ...row, error: undefined };
    const result = schema.safeParse(normalize(row.values));
    if (result.success) return row.error === undefined ? row : { ...row, error: undefined };
    const [firstIssue] = result.error.issues;
    if (firstInvalidId === null) firstInvalidId = row.id;
    return { ...row, error: firstIssue?.message ?? 'Élément invalide.' };
  });
  return { rows: nextRows, firstInvalidId };
}

/**
 * Reporte sur les lignes déjà envoyées les erreurs serveur qui les visent
 * (chemins `<blocKey>.<index>.item...`, `index` étant une position dans la
 * liste effectivement envoyée — `sentIds`, capturée au moment de l'envoi).
 * Renvoie l'identifiant de la ligne la plus tôt dans l'ordre d'envoi parmi
 * celles signalées (`null` si aucune erreur ne visait ce bloc).
 */
function applyServerRowErrors<TValues>(
  setRows: Dispatch<SetStateAction<ReviewRow<TValues>[]>>,
  sentIds: readonly string[],
  details: Record<string, string>,
  blockKey: string,
): string | null {
  const prefix = `${blockKey}.`;
  const errorsById = new Map<string, string>();
  let firstIndex: number | null = null;
  for (const [path, message] of Object.entries(details)) {
    if (!path.startsWith(prefix)) continue;
    const indexMatch = /^(\d+)\./.exec(path.slice(prefix.length));
    if (!indexMatch) continue;
    const index = Number(indexMatch[1]);
    const id = sentIds[index];
    if (id === undefined) continue;
    if (!errorsById.has(id)) errorsById.set(id, message);
    if (firstIndex === null || index < firstIndex) firstIndex = index;
  }
  if (errorsById.size === 0) return null;
  setRows((rows) => rows.map((row) => (errorsById.has(row.id) ? { ...row, error: errorsById.get(row.id) } : row)));
  return firstIndex === null ? null : sentIds[firstIndex] ?? null;
}

/**
 * Revue des données extraites d'un CV : identité, puis profil professionnel,
 * en champs directs (édition immédiate, un champ laissé vide n'est pas
 * envoyé), six blocs cochables/éditables réutilisant les champs et le schéma
 * strict de chaque section de profil, et les préférences détectées en puces
 * amovibles. Rien n'est écrit avant le clic sur « Appliquer au profil »
 * (`onSubmit`, porté par l'appelant), et rien n'est envoyé tant qu'une ligne
 * cochée ne satisfait pas le schéma qui la validera de toute façon côté
 * serveur — autant l'annoncer avant l'envoi, ligne par ligne, plutôt que de
 * laisser échouer toute la requête.
 */
export function ExtractionReview({ extraction, onSubmit, isPending, error, onBack, onSkip }: ExtractionReviewProps) {
  const [experienceRows, setExperienceRows] = useState(() =>
    initRows('experiences', extraction.experiences, experienceToFormValues),
  );
  const [educationRows, setEducationRows] = useState(() =>
    initRows('educations', extraction.educations, educationToFormValues),
  );
  const [skillRows, setSkillRows] = useState(() => initRows('skills', extraction.skills, skillToFormValues));
  const [languageRows, setLanguageRows] = useState(() =>
    initRows('languages', extraction.languages, languageToFormValues),
  );
  const [certificationRows, setCertificationRows] = useState(() =>
    initRows('certifications', extraction.certifications, certificationToFormValues),
  );
  const [projectRows, setProjectRows] = useState(() => initRows('projects', extraction.projects, projectToFormValues));
  const [identity, setIdentity] = useState<IdentityState>(() => toIdentityState(extraction.identity));
  const [preferences, setPreferences] = useState<PreferencesState>(() => ({
    desiredRoles: [...extraction.preferences.desiredRoles],
    locations: [...extraction.preferences.locations],
  }));
  const [validationAlert, setValidationAlert] = useState<string | null>(null);
  const [focusRowId, setFocusRowId] = useState<string | null>(null);
  const sentRowIdsRef = useRef<SentRowIds>(EMPTY_SENT_ROW_IDS);

  useEffect(() => {
    if (!focusRowId) return;
    const target = document.getElementById(focusRowId);
    if (target) {
      // jsdom (tests) n'implémente pas `scrollIntoView` : simple bonus visuel, jamais bloquant.
      target.scrollIntoView?.({ behavior: 'smooth', block: 'center' });
      target.focus();
    }
    setFocusRowId(null);
  }, [focusRowId]);

  // Rejet serveur (`VALIDATION_ERROR`) malgré la validation cliente : ne devrait arriver
  // qu'en cas de désaccord entre les deux (bug, ou schéma changé entre-temps) — les erreurs
  // sont reportées sur les lignes de la même façon que la validation avant envoi.
  useEffect(() => {
    if (!(error instanceof ApiError) || error.code !== 'VALIDATION_ERROR' || !error.details) return;
    const details = error.details;
    const firstId =
      applyServerRowErrors(setExperienceRows, sentRowIdsRef.current.experiences, details, 'experiences') ??
      applyServerRowErrors(setEducationRows, sentRowIdsRef.current.educations, details, 'educations') ??
      applyServerRowErrors(setSkillRows, sentRowIdsRef.current.skills, details, 'skills') ??
      applyServerRowErrors(setLanguageRows, sentRowIdsRef.current.languages, details, 'languages') ??
      applyServerRowErrors(setCertificationRows, sentRowIdsRef.current.certifications, details, 'certifications') ??
      applyServerRowErrors(setProjectRows, sentRowIdsRef.current.projects, details, 'projects');
    if (firstId) {
      setValidationAlert(VALIDATION_ALERT_MESSAGE);
      setFocusRowId(firstId);
    }
  }, [error]);

  const isEmptyExtraction =
    extraction.experiences.length === 0 &&
    extraction.educations.length === 0 &&
    extraction.skills.length === 0 &&
    extraction.languages.length === 0 &&
    extraction.certifications.length === 0 &&
    extraction.projects.length === 0 &&
    extraction.preferences.desiredRoles.length === 0 &&
    extraction.preferences.locations.length === 0 &&
    Object.values(extraction.identity).every((value) => value === null);

  if (isEmptyExtraction) {
    return (
      <div className="space-y-4">
        <EmptyState
          icon={Inbox}
          title="Aucune information exploitable n'a été trouvée dans ce document."
          description="Vous pouvez choisir un autre fichier ou continuer sans importer."
        />
        <div className="flex flex-wrap justify-center gap-2">
          <Button variant="outline" onClick={onBack}>
            Choisir un autre fichier
          </Button>
          <Button onClick={onSkip}>Continuer sans importer</Button>
        </div>
      </div>
    );
  }

  const totalSelected =
    countSelected(experienceRows) +
    countSelected(educationRows) +
    countSelected(skillRows) +
    countSelected(languageRows) +
    countSelected(certificationRows) +
    countSelected(projectRows);

  function updateIdentity<K extends keyof IdentityState>(key: K, value: string): void {
    setIdentity((previous) => ({ ...previous, [key]: value }));
  }

  function removeDesiredRole(index: number): void {
    setPreferences((previous) => ({ ...previous, desiredRoles: previous.desiredRoles.filter((_, i) => i !== index) }));
  }

  function removeLocation(index: number): void {
    setPreferences((previous) => ({ ...previous, locations: previous.locations.filter((_, i) => i !== index) }));
  }

  function handleSubmit(): void {
    const skillIdentity = (raw: SkillFormInput) => raw;
    const languageIdentity = (raw: LanguageFormInput) => raw;

    const experienceResult = validateSelectedRows(experienceRows, experienceSchema, normalizeExperience);
    const educationResult = validateSelectedRows(educationRows, educationSchema, normalizeEducation);
    const skillResult = validateSelectedRows(skillRows, skillSchema, skillIdentity);
    const languageResult = validateSelectedRows(languageRows, languageSchema, languageIdentity);
    const certificationResult = validateSelectedRows(certificationRows, certificationSchema, normalizeCertification);
    const projectResult = validateSelectedRows(projectRows, projectSchema, normalizeProject);

    setExperienceRows(experienceResult.rows);
    setEducationRows(educationResult.rows);
    setSkillRows(skillResult.rows);
    setLanguageRows(languageResult.rows);
    setCertificationRows(certificationResult.rows);
    setProjectRows(projectResult.rows);

    const firstInvalidId =
      experienceResult.firstInvalidId ??
      educationResult.firstInvalidId ??
      skillResult.firstInvalidId ??
      languageResult.firstInvalidId ??
      certificationResult.firstInvalidId ??
      projectResult.firstInvalidId;

    if (firstInvalidId !== null) {
      setValidationAlert(VALIDATION_ALERT_MESSAGE);
      setFocusRowId(firstInvalidId);
      return;
    }
    setValidationAlert(null);

    // Seules les lignes cochées sont envoyées (jamais `{ selected: false, item }`) : une
    // ligne inexploitable peut toujours être exclue en la décochant, sans avoir à la corriger.
    const experiencesSent = experienceRows.filter((row) => row.selected);
    const educationsSent = educationRows.filter((row) => row.selected);
    const skillsSent = skillRows.filter((row) => row.selected);
    const languagesSent = languageRows.filter((row) => row.selected);
    const certificationsSent = certificationRows.filter((row) => row.selected);
    const projectsSent = projectRows.filter((row) => row.selected);

    sentRowIdsRef.current = {
      experiences: experiencesSent.map((row) => row.id),
      educations: educationsSent.map((row) => row.id),
      skills: skillsSent.map((row) => row.id),
      languages: languagesSent.map((row) => row.id),
      certifications: certificationsSent.map((row) => row.id),
      projects: projectsSent.map((row) => row.id),
    };

    const body: CvApplyFormInput = {
      identity: {
        firstName: presentOrUndefined(identity.firstName),
        lastName: presentOrUndefined(identity.lastName),
        phone: presentOrUndefined(identity.phone),
        city: presentOrUndefined(identity.city),
        country: presentOrUndefined(identity.country),
        title: presentOrUndefined(identity.title),
        summary: presentOrUndefined(identity.summary),
      },
      experiences: experiencesSent.map((row) => ({
        selected: true,
        item: normalizeExperience(row.values) as ExperienceFormInput,
      })),
      educations: educationsSent.map((row) => ({
        selected: true,
        item: normalizeEducation(row.values) as EducationFormInput,
      })),
      skills: skillsSent.map((row) => ({ selected: true, item: row.values })),
      languages: languagesSent.map((row) => ({ selected: true, item: row.values })),
      certifications: certificationsSent.map((row) => ({
        selected: true,
        item: normalizeCertification(row.values) as CertificationFormInput,
      })),
      projects: projectsSent.map((row) => ({
        selected: true,
        item: normalizeProject(row.values) as ProjectFormInput,
      })),
      preferences: {
        desiredRoles: preferences.desiredRoles.length > 0 ? preferences.desiredRoles : undefined,
        locations: preferences.locations.length > 0 ? preferences.locations : undefined,
      },
    };
    onSubmit(body);
  }

  return (
    <div className="space-y-8">
      {validationAlert && (
        <Alert variant="destructive">
          <AlertCircle />
          <AlertDescription>{validationAlert}</AlertDescription>
        </Alert>
      )}

      <section className="space-y-4">
        <h2 className="text-base font-semibold">Identité et coordonnées</h2>
        <div className="grid grid-cols-2 gap-3">
          <div className="space-y-2">
            <Label htmlFor="rev-firstName">Prénom</Label>
            <Input
              id="rev-firstName"
              value={identity.firstName}
              onChange={(event) => updateIdentity('firstName', event.target.value)}
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="rev-lastName">Nom</Label>
            <Input
              id="rev-lastName"
              value={identity.lastName}
              onChange={(event) => updateIdentity('lastName', event.target.value)}
            />
          </div>
        </div>
        <div className="grid grid-cols-2 gap-3">
          <div className="space-y-2">
            <Label htmlFor="rev-phone">Téléphone</Label>
            <Input
              id="rev-phone"
              value={identity.phone}
              onChange={(event) => updateIdentity('phone', event.target.value)}
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="rev-city">Ville</Label>
            <Input id="rev-city" value={identity.city} onChange={(event) => updateIdentity('city', event.target.value)} />
          </div>
        </div>
        <div className="space-y-2">
          <Label htmlFor="rev-country">Pays</Label>
          <Input
            id="rev-country"
            value={identity.country}
            onChange={(event) => updateIdentity('country', event.target.value)}
          />
        </div>
      </section>

      <section className="space-y-4">
        <h2 className="text-base font-semibold">Profil professionnel</h2>
        <div className="space-y-2">
          <Label htmlFor="rev-title">Titre</Label>
          <Input id="rev-title" value={identity.title} onChange={(event) => updateIdentity('title', event.target.value)} />
        </div>
        <div className="space-y-2">
          <Label htmlFor="rev-summary">Résumé</Label>
          <Textarea
            id="rev-summary"
            rows={4}
            value={identity.summary}
            onChange={(event) => updateIdentity('summary', event.target.value)}
          />
        </div>
      </section>

      {experienceRows.length > 0 && (
        <ReviewBlock
          icon={Briefcase}
          title="Expériences"
          rows={experienceRows}
          onChange={setExperienceRows}
          schema={experienceSchema}
          normalize={normalizeExperience}
          renderFields={(form) => <ExperienceFields form={form} />}
          rowLabel={(values) => `${values.role} – ${values.company}`}
          renderSummary={(values) => (
            <div>
              <p className="font-semibold">{values.role}</p>
              <p className="text-muted-foreground text-sm">
                {values.company} · {formatMonthYear(values.startDate)} –{' '}
                {values.isCurrent ? 'aujourd’hui' : values.endDate ? formatMonthYear(values.endDate) : '—'}
              </p>
            </div>
          )}
        />
      )}

      {educationRows.length > 0 && (
        <ReviewBlock
          icon={GraduationCap}
          title="Formations"
          rows={educationRows}
          onChange={setEducationRows}
          schema={educationSchema}
          normalize={normalizeEducation}
          renderFields={(form) => <EducationFields form={form} />}
          rowLabel={(values) => `${values.degree} – ${values.school}`}
          renderSummary={(values) => (
            <div>
              <p className="font-semibold">{values.degree}</p>
              <p className="text-muted-foreground text-sm">
                {values.school} · {formatMonthYear(values.startDate)} –{' '}
                {values.endDate ? formatMonthYear(values.endDate) : 'en cours'}
              </p>
            </div>
          )}
        />
      )}

      {skillRows.length > 0 && (
        <ReviewBlock
          icon={Sparkles}
          title="Compétences"
          rows={skillRows}
          onChange={setSkillRows}
          schema={skillSchema}
          normalize={(raw) => raw}
          renderFields={(form) => <SkillFields form={form} />}
          rowLabel={(values) => values.name}
          renderSummary={(values) => <p className="font-medium">{values.name}</p>}
        />
      )}

      {languageRows.length > 0 && (
        <ReviewBlock
          icon={LanguagesIcon}
          title="Langues"
          rows={languageRows}
          onChange={setLanguageRows}
          schema={languageSchema}
          normalize={(raw) => raw}
          renderFields={(form) => <LanguageFields form={form} />}
          rowLabel={(values) => values.name}
          renderSummary={(values) => <p className="font-medium">{values.name}</p>}
        />
      )}

      {certificationRows.length > 0 && (
        <ReviewBlock
          icon={Award}
          title="Certifications"
          rows={certificationRows}
          onChange={setCertificationRows}
          schema={certificationSchema}
          normalize={normalizeCertification}
          renderFields={(form) => <CertificationFields form={form} />}
          rowLabel={(values) => `${values.name} – ${values.issuer}`}
          renderSummary={(values) => (
            <div>
              <p className="font-semibold">{values.name}</p>
              <p className="text-muted-foreground text-sm">
                {values.issuer} · {formatMonthYear(values.issuedAt)}
              </p>
            </div>
          )}
        />
      )}

      {projectRows.length > 0 && (
        <ReviewBlock
          icon={FolderGit2}
          title="Projets"
          rows={projectRows}
          onChange={setProjectRows}
          schema={projectSchema}
          normalize={normalizeProject}
          renderFields={(form) => <ProjectFields form={form} />}
          rowLabel={(values) => values.name}
          renderSummary={(values) => (
            <div>
              <p className="font-semibold">{values.name}</p>
              {values.technologies && <p className="text-muted-foreground text-sm">{values.technologies}</p>}
            </div>
          )}
        />
      )}

      <section className="space-y-4">
        <h2 className="text-base font-semibold">Préférences de recherche</h2>
        <div className="space-y-2">
          <p className="text-sm font-medium">Postes recherchés</p>
          <div className="flex flex-wrap gap-2">
            {preferences.desiredRoles.length === 0 && (
              <p className="text-muted-foreground text-sm">Aucun poste détecté.</p>
            )}
            {preferences.desiredRoles.map((role, index) => (
              <Badge key={role} variant="secondary" className="gap-1">
                {role}
                <button type="button" aria-label={`Retirer « ${role} »`} onClick={() => removeDesiredRole(index)}>
                  <X className="size-3" />
                </button>
              </Badge>
            ))}
          </div>
        </div>
        <div className="space-y-2">
          <p className="text-sm font-medium">Lieux</p>
          <div className="flex flex-wrap gap-2">
            {preferences.locations.length === 0 && <p className="text-muted-foreground text-sm">Aucun lieu détecté.</p>}
            {preferences.locations.map((location, index) => (
              <Badge key={location} variant="secondary" className="gap-1">
                {location}
                <button type="button" aria-label={`Retirer « ${location} »`} onClick={() => removeLocation(index)}>
                  <X className="size-3" />
                </button>
              </Badge>
            ))}
          </div>
        </div>
      </section>

      <div className="space-y-3 border-t pt-4">
        <ServerErrorAlert message={error ? topLevelMessage(error) : undefined} />
        <p className="text-muted-foreground text-sm" aria-live="polite">
          {footerMessage(totalSelected)}
        </p>
        <div className="flex flex-wrap gap-2">
          <Button onClick={handleSubmit} disabled={isPending}>
            {isPending ? 'Application…' : 'Appliquer au profil'}
          </Button>
          <Button type="button" variant="ghost" onClick={onSkip} disabled={isPending}>
            Continuer sans importer
          </Button>
        </div>
      </div>
    </div>
  );
}
