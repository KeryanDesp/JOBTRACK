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

function normalize(raw: unknown): unknown {
  return emptyToNull(raw as Record<string, unknown>, ['endDate']);
}

const DEFAULT_VALUES = {
  school: '',
  degree: '',
  field: '',
  startDate: '',
  endDate: '',
  description: '',
} as unknown as EducationFormInput;

function toFormValues(item: CollectionItem<'educations'>): EducationFormInput {
  return {
    school: item.school,
    degree: item.degree,
    field: item.field ?? '',
    startDate: item.startDate,
    endDate: item.endDate ?? '',
    description: item.description ?? '',
  };
}

function EducationFields({ form }: { form: UseFormReturn<EducationFormInput> }) {
  const {
    register,
    formState: { errors },
  } = form;

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 gap-3">
        <div className="space-y-2">
          <Label htmlFor="edu-school">Établissement</Label>
          <Input id="edu-school" aria-invalid={errors.school ? true : undefined} {...register('school')} />
          <FormFieldError message={errors.school?.message} />
        </div>
        <div className="space-y-2">
          <Label htmlFor="edu-degree">Diplôme</Label>
          <Input id="edu-degree" aria-invalid={errors.degree ? true : undefined} {...register('degree')} />
          <FormFieldError message={errors.degree?.message} />
        </div>
      </div>

      <div className="space-y-2">
        <Label htmlFor="edu-field">Domaine</Label>
        <Input id="edu-field" {...register('field')} />
      </div>

      <div className="grid grid-cols-2 gap-3">
        <div className="space-y-2">
          <Label htmlFor="edu-start">Date de début</Label>
          <Input id="edu-start" type="date" aria-invalid={errors.startDate ? true : undefined} {...register('startDate')} />
          <FormFieldError message={errors.startDate?.message} />
        </div>
        <div className="space-y-2">
          <Label htmlFor="edu-end">Date de fin</Label>
          <Input id="edu-end" type="date" aria-invalid={errors.endDate ? true : undefined} {...register('endDate')} />
          <FormFieldError message={errors.endDate?.message} />
        </div>
      </div>

      <div className="space-y-2">
        <Label htmlFor="edu-description">Description</Label>
        <Textarea id="edu-description" rows={3} {...register('description')} />
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
