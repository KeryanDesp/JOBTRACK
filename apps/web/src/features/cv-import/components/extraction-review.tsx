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
  type ProjectFormInput,
} from '@jobtrack/shared';
import { Award, Briefcase, FolderGit2, GraduationCap, Inbox, Languages as LanguagesIcon, Sparkles, X } from 'lucide-react';
import { useState } from 'react';
import { EmptyState } from '@/components/shared/empty-state';
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
 * chaque élément part sélectionné, et `toFormValues` (exportée par la section
 * de profil correspondante) attend un `CollectionItem` complet — `id` et
 * `sortOrder` n'y sont jamais lus, on les complète ici par une valeur muette
 * plutôt que dupliquer la conversion.
 */
function initRows<TDraft extends object, TValues>(
  drafts: readonly TDraft[],
  toFormValues: (item: TDraft & { id: string; sortOrder: number }) => TValues,
): ReviewRow<TValues>[] {
  return drafts.map((draft) => ({ selected: true, values: toFormValues({ ...draft, id: '', sortOrder: 0 }) }));
}

function countSelected(rows: readonly ReviewRow<unknown>[]): number {
  return rows.filter((row) => row.selected).length;
}

/**
 * Revue des données extraites d'un CV : identité et titre/résumé en champs
 * directs (édition immédiate, un champ laissé vide n'est pas envoyé), six
 * blocs cochables/éditables réutilisant les champs et le schéma strict de
 * chaque section de profil, et les préférences détectées en puces amovibles.
 * Rien n'est écrit avant le clic sur « Appliquer au profil » (`onSubmit`,
 * porté par l'appelant) : ce composant ne fait que construire le corps de la
 * requête à partir de l'état local.
 */
export function ExtractionReview({ extraction, onSubmit, isPending, error, onBack, onSkip }: ExtractionReviewProps) {
  const [experienceRows, setExperienceRows] = useState(() => initRows(extraction.experiences, experienceToFormValues));
  const [educationRows, setEducationRows] = useState(() => initRows(extraction.educations, educationToFormValues));
  const [skillRows, setSkillRows] = useState(() => initRows(extraction.skills, skillToFormValues));
  const [languageRows, setLanguageRows] = useState(() => initRows(extraction.languages, languageToFormValues));
  const [certificationRows, setCertificationRows] = useState(() =>
    initRows(extraction.certifications, certificationToFormValues),
  );
  const [projectRows, setProjectRows] = useState(() => initRows(extraction.projects, projectToFormValues));
  const [identity, setIdentity] = useState<IdentityState>(() => toIdentityState(extraction.identity));
  const [preferences, setPreferences] = useState<PreferencesState>(() => ({
    desiredRoles: [...extraction.preferences.desiredRoles],
    locations: [...extraction.preferences.locations],
  }));

  const isEmptyExtraction =
    extraction.experiences.length === 0 &&
    extraction.educations.length === 0 &&
    extraction.skills.length === 0 &&
    extraction.languages.length === 0 &&
    extraction.certifications.length === 0 &&
    extraction.projects.length === 0 &&
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
      experiences: experienceRows.map((row) => ({
        selected: row.selected,
        item: normalizeExperience(row.values) as ExperienceFormInput,
      })),
      educations: educationRows.map((row) => ({
        selected: row.selected,
        item: normalizeEducation(row.values) as EducationFormInput,
      })),
      skills: skillRows.map((row) => ({ selected: row.selected, item: row.values })),
      languages: languageRows.map((row) => ({ selected: row.selected, item: row.values })),
      certifications: certificationRows.map((row) => ({
        selected: row.selected,
        item: normalizeCertification(row.values) as CertificationFormInput,
      })),
      projects: projectRows.map((row) => ({
        selected: row.selected,
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
              <Badge key={`${index}-${role}`} variant="secondary" className="gap-1">
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
              <Badge key={`${index}-${location}`} variant="secondary" className="gap-1">
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
        <p className="text-muted-foreground text-sm">
          {totalSelected === 1
            ? '1 élément sera ajouté à votre profil.'
            : `${totalSelected} éléments seront ajoutés à votre profil.`}
        </p>
        <div className="flex flex-wrap gap-2">
          <Button onClick={handleSubmit} disabled={isPending}>
            {isPending ? 'Application…' : 'Appliquer au profil'}
          </Button>
          <Button type="button" variant="ghost" onClick={onSkip}>
            Continuer sans importer
          </Button>
        </div>
      </div>
    </div>
  );
}
