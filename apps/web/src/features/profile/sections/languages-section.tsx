import { languageSchema, type LanguageFormInput } from '@jobtrack/shared';
import { Languages as LanguagesIcon } from 'lucide-react';
import { Controller, type UseFormReturn } from 'react-hook-form';
import { CollectionSection } from '../components/collection-section';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { FormFieldError } from '@/features/auth/components/form-field-error';
import type { CollectionItem } from '@/services/api/profile';

// Exportée : réutilisée par la revue d'extraction de CV (`extraction-review.tsx`).
export const LEVEL_LABELS: Record<LanguageFormInput['level'], string> = {
  A1: 'A1',
  A2: 'A2',
  B1: 'B1',
  B2: 'B2',
  C1: 'C1',
  C2: 'C2',
  NATIVE: 'Langue maternelle',
};

// Exportées : réutilisées par la revue d'extraction de CV (`extraction-review.tsx`).
export const DEFAULT_VALUES: LanguageFormInput = { name: '', level: 'A1' };

export function toFormValues(item: CollectionItem<'languages'>): LanguageFormInput {
  return { name: item.name, level: item.level };
}

export function LanguageFields({ form }: { form: UseFormReturn<LanguageFormInput> }) {
  const {
    register,
    control,
    formState: { errors },
  } = form;

  return (
    <div className="space-y-4">
      <div className="space-y-2">
        <Label htmlFor="lang-name">Langue</Label>
        <Input
          id="lang-name"
          aria-invalid={errors.name ? true : undefined}
          aria-describedby={errors.name ? 'lang-name-error' : undefined}
          {...register('name')}
        />
        <FormFieldError id="lang-name-error" message={errors.name?.message} />
      </div>
      <div className="space-y-2">
        <Label htmlFor="lang-level">Niveau</Label>
        <Controller
          control={control}
          name="level"
          render={({ field }) => (
            <Select value={field.value} onValueChange={field.onChange}>
              <SelectTrigger
                id="lang-level"
                className="w-full"
                aria-invalid={errors.level ? true : undefined}
                aria-describedby={errors.level ? 'lang-level-error' : undefined}
              >
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {Object.entries(LEVEL_LABELS).map(([value, label]) => (
                  <SelectItem key={value} value={value}>
                    {label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          )}
        />
        <FormFieldError id="lang-level-error" message={errors.level?.message} />
      </div>
    </div>
  );
}

export function LanguagesSection() {
  return (
    <CollectionSection
      name="languages"
      title="Langues"
      description="Les langues que vous parlez et votre niveau."
      icon={LanguagesIcon}
      emptyLabel="Aucune langue ajoutée."
      addLabel="Ajouter une langue"
      deleteLabel="Supprimer cette langue"
      schema={languageSchema}
      defaultValues={DEFAULT_VALUES}
      normalize={(raw) => raw}
      toFormValues={toFormValues}
      renderSummary={(item) => (
        <div>
          <p className="font-medium">{item.name}</p>
          <p className="text-muted-foreground text-sm">{LEVEL_LABELS[item.level]}</p>
        </div>
      )}
      renderFields={(form) => <LanguageFields form={form} />}
    />
  );
}
