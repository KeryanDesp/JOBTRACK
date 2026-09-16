import { educationSchema, type EducationFormInput } from '@jobtrack/shared';
import { GraduationCap } from 'lucide-react';
import type { UseFormReturn } from 'react-hook-form';
import { CollectionSection } from '../components/collection-section';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { FormFieldError } from '@/features/auth/components/form-field-error';
import { emptyToNull } from '@/lib/forms';
import { formatMonthYear } from '@/lib/dates';
import type { CollectionItem } from '@/services/api/profile';

/** `endDate` reste une chaîne côté formulaire (voir `experiences-section.tsx`). */
export type EducationFormValues = Omit<EducationFormInput, 'endDate'> & { endDate: string };

// Exportée : réutilisée par la revue d'extraction de CV (`extraction-review.tsx`).
export function normalize(raw: EducationFormValues): unknown {
  return emptyToNull(raw, ['endDate']);
}

export const DEFAULT_VALUES: EducationFormValues = {
  school: '',
  degree: '',
  field: '',
  startDate: '',
  endDate: '',
  description: '',
};

export function toFormValues(item: CollectionItem<'educations'>): EducationFormValues {
  return {
    school: item.school,
    degree: item.degree,
    field: item.field ?? '',
    startDate: item.startDate,
    endDate: item.endDate ?? '',
    description: item.description ?? '',
  };
}

export function EducationFields({ form }: { form: UseFormReturn<EducationFormValues> }) {
  const {
    register,
    formState: { errors },
  } = form;

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 gap-3">
        <div className="space-y-2">
          <Label htmlFor="edu-school">Établissement</Label>
          <Input
            id="edu-school"
            aria-invalid={errors.school ? true : undefined}
            aria-describedby={errors.school ? 'edu-school-error' : undefined}
            {...register('school')}
          />
          <FormFieldError id="edu-school-error" message={errors.school?.message} />
        </div>
        <div className="space-y-2">
          <Label htmlFor="edu-degree">Diplôme</Label>
          <Input
            id="edu-degree"
            aria-invalid={errors.degree ? true : undefined}
            aria-describedby={errors.degree ? 'edu-degree-error' : undefined}
            {...register('degree')}
          />
          <FormFieldError id="edu-degree-error" message={errors.degree?.message} />
        </div>
      </div>

      <div className="space-y-2">
        <Label htmlFor="edu-field">Domaine</Label>
        <Input
          id="edu-field"
          aria-invalid={errors.field ? true : undefined}
          aria-describedby={errors.field ? 'edu-field-error' : undefined}
          {...register('field')}
        />
        <FormFieldError id="edu-field-error" message={errors.field?.message} />
      </div>

      <div className="grid grid-cols-2 gap-3">
        <div className="space-y-2">
          <Label htmlFor="edu-start">Date de début</Label>
          <Input
            id="edu-start"
            type="date"
            aria-invalid={errors.startDate ? true : undefined}
            aria-describedby={errors.startDate ? 'edu-start-error' : undefined}
            {...register('startDate')}
          />
          <FormFieldError id="edu-start-error" message={errors.startDate?.message} />
        </div>
        <div className="space-y-2">
          <Label htmlFor="edu-end">Date de fin</Label>
          <Input
            id="edu-end"
            type="date"
            aria-invalid={errors.endDate ? true : undefined}
            aria-describedby={errors.endDate ? 'edu-end-error' : undefined}
            {...register('endDate')}
          />
          <FormFieldError id="edu-end-error" message={errors.endDate?.message} />
        </div>
      </div>

      <div className="space-y-2">
        <Label htmlFor="edu-description">Description</Label>
        <Textarea
          id="edu-description"
          rows={3}
          aria-invalid={errors.description ? true : undefined}
          aria-describedby={errors.description ? 'edu-description-error' : undefined}
          {...register('description')}
        />
        <FormFieldError id="edu-description-error" message={errors.description?.message} />
      </div>
    </div>
  );
}

export function EducationsSection() {
  return (
    <CollectionSection
      name="educations"
      title="Formations"
      description="Vos diplômes et parcours académique."
      icon={GraduationCap}
      emptyLabel="Aucune formation ajoutée."
      addLabel="Ajouter une formation"
      deleteLabel="Supprimer cette formation"
      schema={educationSchema}
      defaultValues={DEFAULT_VALUES}
      normalize={normalize}
      toFormValues={toFormValues}
      renderSummary={(item) => (
        <div>
          <p className="font-semibold">{item.degree}</p>
          <p className="text-muted-foreground text-sm">
            {item.school} · {formatMonthYear(item.startDate)} – {item.endDate ? formatMonthYear(item.endDate) : 'en cours'}
          </p>
        </div>
      )}
      renderFields={(form) => <EducationFields form={form} />}
    />
  );
}
