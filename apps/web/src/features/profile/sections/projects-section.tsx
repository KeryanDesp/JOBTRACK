import { projectSchema, type ProjectFormInput } from '@jobtrack/shared';
import { FolderGit2 } from 'lucide-react';
import type { UseFormReturn } from 'react-hook-form';
import { CollectionSection } from '../components/collection-section';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { FormFieldError } from '@/features/auth/components/form-field-error';
import { joinTags, splitTags } from '@/lib/forms';
import type { CollectionItem } from '@/services/api/profile';

/**
 * `technologies` reste une chaîne (les tags séparés par des virgules tels
 * que le champ HTML les produit), contrairement à `ProjectFormInput` dont le
 * type reflète ce que le schéma accepte (`string[]`).
 */
export type ProjectFormValues = Omit<ProjectFormInput, 'technologies'> & { technologies: string };

// `technologies` : chaîne de tags séparés par des virgules côté formulaire,
// tableau côté schéma. `url`/`description` (optionnels) acceptent déjà `''`.
// Exportée : réutilisée par la revue d'extraction de CV (`extraction-review.tsx`).
export function normalize(raw: ProjectFormValues): unknown {
  return splitTags(raw, 'technologies');
}

const DEFAULT_VALUES: ProjectFormValues = {
  name: '',
  description: '',
  url: '',
  technologies: '',
};

export function toFormValues(item: CollectionItem<'projects'>): ProjectFormValues {
  return {
    name: item.name,
    description: item.description ?? '',
    url: item.url ?? '',
    technologies: joinTags(item.technologies),
  };
}

export function ProjectFields({ form }: { form: UseFormReturn<ProjectFormValues> }) {
  const {
    register,
    formState: { errors },
  } = form;

  return (
    <div className="space-y-4">
      <div className="space-y-2">
        <Label htmlFor="proj-name">Nom</Label>
        <Input
          id="proj-name"
          aria-invalid={errors.name ? true : undefined}
          aria-describedby={errors.name ? 'proj-name-error' : undefined}
          {...register('name')}
        />
        <FormFieldError id="proj-name-error" message={errors.name?.message} />
      </div>

      <div className="space-y-2">
        <Label htmlFor="proj-description">Description</Label>
        <Textarea
          id="proj-description"
          rows={3}
          aria-invalid={errors.description ? true : undefined}
          aria-describedby={errors.description ? 'proj-description-error' : undefined}
          {...register('description')}
        />
        <FormFieldError id="proj-description-error" message={errors.description?.message} />
      </div>

      <div className="space-y-2">
        <Label htmlFor="proj-url">Lien</Label>
        <Input
          id="proj-url"
          type="url"
          aria-invalid={errors.url ? true : undefined}
          aria-describedby={errors.url ? 'proj-url-error' : undefined}
          {...register('url')}
        />
        <FormFieldError id="proj-url-error" message={errors.url?.message} />
      </div>

      <div className="space-y-2">
        <Label htmlFor="proj-technologies">Technologies</Label>
        <Input
          id="proj-technologies"
          aria-invalid={errors.technologies ? true : undefined}
          aria-describedby={errors.technologies ? 'proj-technologies-hint proj-technologies-error' : 'proj-technologies-hint'}
          {...register('technologies')}
        />
        <p id="proj-technologies-hint" className="text-muted-foreground text-sm">
          Séparez par des virgules.
        </p>
        <FormFieldError id="proj-technologies-error" message={errors.technologies?.message} />
      </div>
    </div>
  );
}

export function ProjectsSection() {
  return (
    <CollectionSection
      name="projects"
      title="Projets"
      description="Vos projets personnels ou open source."
      icon={FolderGit2}
      emptyLabel="Aucun projet ajouté."
      addLabel="Ajouter un projet"
      deleteLabel="Supprimer ce projet"
      schema={projectSchema}
      defaultValues={DEFAULT_VALUES}
      normalize={normalize}
      toFormValues={toFormValues}
      renderSummary={(item) => (
        <div>
          <p className="font-semibold">{item.name}</p>
          {item.technologies.length > 0 && (
            <p className="text-muted-foreground text-sm">{joinTags(item.technologies)}</p>
          )}
        </div>
      )}
      renderFields={(form) => <ProjectFields form={form} />}
    />
  );
}
