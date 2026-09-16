import { skillSchema, type SkillFormInput } from '@jobtrack/shared';
import { Sparkles } from 'lucide-react';
import { Controller, type UseFormReturn } from 'react-hook-form';
import { CollectionSection } from '../components/collection-section';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { FormFieldError } from '@/features/auth/components/form-field-error';
import type { CollectionItem } from '@/services/api/profile';

const CATEGORY_LABELS: Record<SkillFormInput['category'] & string, string> = {
  TECHNICAL: 'Technique',
  SOFT: 'Savoir-être',
  TOOL: 'Outil',
  OTHER: 'Autre',
};

const LEVEL_LABELS: Record<SkillFormInput['level'] & string, string> = {
  BEGINNER: 'Débutant',
  INTERMEDIATE: 'Intermédiaire',
  ADVANCED: 'Avancé',
  EXPERT: 'Expert',
};

const DEFAULT_VALUES: SkillFormInput = { name: '', category: 'TECHNICAL', level: 'INTERMEDIATE' };

function toFormValues(item: CollectionItem<'skills'>): SkillFormInput {
  return { name: item.name, category: item.category, level: item.level };
}

function SkillFields({ form }: { form: UseFormReturn<SkillFormInput> }) {
  const {
    register,
    control,
    formState: { errors },
  } = form;

  return (
    <div className="space-y-4">
      <div className="space-y-2">
        <Label htmlFor="skill-name">Nom</Label>
        <Input
          id="skill-name"
          aria-invalid={errors.name ? true : undefined}
          aria-describedby={errors.name ? 'skill-name-error' : undefined}
          {...register('name')}
        />
        <FormFieldError id="skill-name-error" message={errors.name?.message} />
      </div>

      <div className="grid grid-cols-2 gap-3">
        <div className="space-y-2">
          <Label htmlFor="skill-category">Catégorie</Label>
          <Controller
            control={control}
            name="category"
            render={({ field }) => (
              <Select value={field.value ?? 'TECHNICAL'} onValueChange={field.onChange}>
                <SelectTrigger
                  id="skill-category"
                  className="w-full"
                  aria-invalid={errors.category ? true : undefined}
                  aria-describedby={errors.category ? 'skill-category-error' : undefined}
                >
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {Object.entries(CATEGORY_LABELS).map(([value, label]) => (
                    <SelectItem key={value} value={value}>
                      {label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            )}
          />
          <FormFieldError id="skill-category-error" message={errors.category?.message} />
        </div>
        <div className="space-y-2">
          <Label htmlFor="skill-level">Niveau</Label>
          <Controller
            control={control}
            name="level"
            render={({ field }) => (
              <Select value={field.value ?? 'INTERMEDIATE'} onValueChange={field.onChange}>
                <SelectTrigger
                  id="skill-level"
                  className="w-full"
                  aria-invalid={errors.level ? true : undefined}
                  aria-describedby={errors.level ? 'skill-level-error' : undefined}
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
          <FormFieldError id="skill-level-error" message={errors.level?.message} />
        </div>
      </div>
    </div>
  );
}

export function SkillsSection() {
  return (
    <CollectionSection
      name="skills"
      title="Compétences"
      description="Vos compétences techniques et humaines."
      icon={Sparkles}
      emptyLabel="Aucune compétence ajoutée."
      addLabel="Ajouter une compétence"
      deleteLabel="Supprimer cette compétence"
      schema={skillSchema}
      defaultValues={DEFAULT_VALUES}
      normalize={(raw) => raw}
      toFormValues={toFormValues}
      renderSummary={(item) => (
        <div>
          <p className="font-medium">{item.name}</p>
          <p className="text-muted-foreground text-sm">
            {CATEGORY_LABELS[item.category]} · {LEVEL_LABELS[item.level]}
          </p>
        </div>
      )}
      renderFields={(form) => <SkillFields form={form} />}
    />
  );
}
