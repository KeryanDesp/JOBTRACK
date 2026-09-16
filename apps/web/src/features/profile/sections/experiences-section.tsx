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

// `endDate` (nullable, sans branche `''`) a besoin de `null` ; `location` et
// `description` (texte optionnel) acceptent déjà `''` nativement et n'ont pas
// besoin d'être convertis (les y convertir enverrait `null`, rejeté par le
// schéma partagé, cf. `lib/forms.ts`).
function normalize(raw: unknown): unknown {
  return emptyToNull(raw as Record<string, unknown>, ['endDate']);
}

// `''` côté champ date HTML : le type d'entrée du schéma exclut `''` sur
// `endDate` mais un `<input type="date">` non renseigné ne connaît que ça.
const DEFAULT_VALUES = {
  company: '',
  role: '',
  location: '',
  startDate: '',
  endDate: '',
  isCurrent: false,
  description: '',
} as unknown as ExperienceFormInput;

function toFormValues(item: CollectionItem<'experiences'>): ExperienceFormInput {
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

function ExperienceFields({ form }: { form: UseFormReturn<ExperienceFormInput> }) {
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
          <Input id="exp-company" aria-invalid={errors.company ? true : undefined} {...register('company')} />
          <FormFieldError message={errors.company?.message} />
        </div>
        <div className="space-y-2">
          <Label htmlFor="exp-role">Poste</Label>
          <Input id="exp-role" aria-invalid={errors.role ? true : undefined} {...register('role')} />
          <FormFieldError message={errors.role?.message} />
        </div>
      </div>

      <div className="space-y-2">
        <Label htmlFor="exp-location">Lieu</Label>
        <Input id="exp-location" {...register('location')} />
      </div>

      <div className="grid grid-cols-2 gap-3">
        <div className="space-y-2">
          <Label htmlFor="exp-start">Date de début</Label>
          <Input id="exp-start" type="date" aria-invalid={errors.startDate ? true : undefined} {...register('startDate')} />
          <FormFieldError message={errors.startDate?.message} />
        </div>
        <div className="space-y-2">
          <Label htmlFor="exp-end">Date de fin</Label>
          <Input
            id="exp-end"
            type="date"
            disabled={isCurrent}
            aria-invalid={errors.endDate ? true : undefined}
            {...register('endDate')}
          />
          <FormFieldError message={errors.endDate?.message} />
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
        <Textarea id="exp-description" rows={3} {...register('description')} />
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
