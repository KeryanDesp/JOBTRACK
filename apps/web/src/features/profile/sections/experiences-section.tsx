import { experienceSchema, type ExperienceFormInput } from '@jobtrack/shared';
import { Briefcase } from 'lucide-react';
import type { UseFormReturn } from 'react-hook-form';
import { CollectionSection } from '../components/collection-section';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import { Textarea } from '@/components/ui/textarea';
import { FormFieldError } from '@/features/auth/components/form-field-error';
import { emptyToNull } from '@/lib/forms';
import { formatMonthYear } from '@/lib/dates';
import type { CollectionItem } from '@/services/api/profile';

/**
 * Valeurs telles que les champs HTML de ce formulaire les produisent
 * réellement : `endDate` reste une chaîne (un `<input type="date">` vide
 * renvoie `''`, jamais `null`), contrairement à `ExperienceFormInput` dont le
 * type reflète ce que le schéma accepte (`string | null | undefined`).
 */
export type ExperienceFormValues = Omit<ExperienceFormInput, 'endDate'> & { endDate: string };

// `endDate` (nullable, sans branche `''`) a besoin de `null` ; `location` et
// `description` (texte optionnel) acceptent déjà `''` nativement et n'ont pas
// besoin d'être convertis (les y convertir enverrait `null`, rejeté par le
// schéma partagé, cf. `lib/forms.ts`).
// Exportée : réutilisée par la revue d'extraction de CV (`extraction-review.tsx`)
// pour normaliser un brouillon édité avant de l'envoyer avec le même schéma.
export function normalize(raw: ExperienceFormValues): unknown {
  return emptyToNull(raw, ['endDate']);
}

const DEFAULT_VALUES: ExperienceFormValues = {
  company: '',
  role: '',
  location: '',
  startDate: '',
  endDate: '',
  isCurrent: false,
  description: '',
};

export function toFormValues(item: CollectionItem<'experiences'>): ExperienceFormValues {
  return {
    company: item.company,
    role: item.role,
    location: item.location ?? '',
    startDate: item.startDate,
    endDate: item.endDate ?? '',
    isCurrent: item.isCurrent,
    description: item.description ?? '',
  };
}

export function ExperienceFields({ form }: { form: UseFormReturn<ExperienceFormValues> }) {
  const {
    register,
    watch,
    setValue,
    formState: { errors },
  } = form;
  const isCurrent = Boolean(watch('isCurrent'));

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 gap-3">
        <div className="space-y-2">
          <Label htmlFor="exp-company">Entreprise</Label>
          <Input
            id="exp-company"
            aria-invalid={errors.company ? true : undefined}
            aria-describedby={errors.company ? 'exp-company-error' : undefined}
            {...register('company')}
          />
          <FormFieldError id="exp-company-error" message={errors.company?.message} />
        </div>
        <div className="space-y-2">
          <Label htmlFor="exp-role">Poste</Label>
          <Input
            id="exp-role"
            aria-invalid={errors.role ? true : undefined}
            aria-describedby={errors.role ? 'exp-role-error' : undefined}
            {...register('role')}
          />
          <FormFieldError id="exp-role-error" message={errors.role?.message} />
        </div>
      </div>

      <div className="space-y-2">
        <Label htmlFor="exp-location">Lieu</Label>
        <Input
          id="exp-location"
          aria-invalid={errors.location ? true : undefined}
          aria-describedby={errors.location ? 'exp-location-error' : undefined}
          {...register('location')}
        />
        <FormFieldError id="exp-location-error" message={errors.location?.message} />
      </div>

      <div className="grid grid-cols-2 gap-3">
        <div className="space-y-2">
          <Label htmlFor="exp-start">Date de début</Label>
          <Input
            id="exp-start"
            type="date"
            aria-invalid={errors.startDate ? true : undefined}
            aria-describedby={errors.startDate ? 'exp-start-error' : undefined}
            {...register('startDate')}
          />
          <FormFieldError id="exp-start-error" message={errors.startDate?.message} />
        </div>
        <div className="space-y-2">
          <Label htmlFor="exp-end">Date de fin</Label>
          <Input
            id="exp-end"
            type="date"
            disabled={isCurrent}
            aria-invalid={errors.endDate ? true : undefined}
            aria-describedby={errors.endDate ? 'exp-end-error' : undefined}
            {...register('endDate')}
          />
          <FormFieldError id="exp-end-error" message={errors.endDate?.message} />
        </div>
      </div>

      <div className="flex items-center gap-2">
        <Switch
          id="exp-current"
          checked={isCurrent}
          onCheckedChange={(checked) => {
            setValue('isCurrent', checked, { shouldDirty: true });
            if (checked) {
              setValue('endDate', '', { shouldDirty: true });
            }
          }}
        />
        <Label htmlFor="exp-current">Poste actuel</Label>
      </div>

      <div className="space-y-2">
        <Label htmlFor="exp-description">Description</Label>
        <Textarea
          id="exp-description"
          rows={3}
          aria-invalid={errors.description ? true : undefined}
          aria-describedby={errors.description ? 'exp-description-error' : undefined}
          {...register('description')}
        />
        <FormFieldError id="exp-description-error" message={errors.description?.message} />
      </div>
    </div>
  );
}

export function ExperiencesSection() {
  return (
    <CollectionSection
      name="experiences"
      title="Expériences"
      description="Votre parcours professionnel."
      icon={Briefcase}
      emptyLabel="Aucune expérience ajoutée."
      addLabel="Ajouter une expérience"
      deleteLabel="Supprimer cette expérience"
      schema={experienceSchema}
      defaultValues={DEFAULT_VALUES}
      normalize={normalize}
      toFormValues={toFormValues}
      renderSummary={(item) => (
        <div>
          <p className="font-semibold">{item.role}</p>
          <p className="text-muted-foreground text-sm">
            {item.company} · {formatMonthYear(item.startDate)} –{' '}
            {item.isCurrent ? 'aujourd’hui' : item.endDate ? formatMonthYear(item.endDate) : '—'}
          </p>
        </div>
      )}
      renderFields={(form) => <ExperienceFields form={form} />}
    />
  );
}
