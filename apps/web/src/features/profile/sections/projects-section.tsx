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

// `technologies` : chaîne de tags séparés par des virgules côté formulaire,
// tableau côté schéma. `url`/`description` (optionnels) acceptent déjà `''`.
function normalize(raw: unknown): unknown {
  return splitTags(raw as Record<string, unknown>, 'technologies');
}

const DEFAULT_VALUES = {
  name: '',
  description: '',
  url: '',
  technologies: '',
} as unknown as ProjectFormInput;

function toFormValues(item: CollectionItem<'projects'>): ProjectFormInput {
  return {
    name: item.name,
    description: item.description ?? '',
    url: item.url ?? '',
    technologies: joinTags(item.technologies),
  } as unknown as ProjectFormInput;
}

function ProjectFields({ form }: { form: UseFormReturn<ProjectFormInput> }) {
  const {
    register,
    formState: { errors },
  } = form;

  return (
    <div className="space-y-4">
      <div className="space-y-2">
        <Label htmlFor="proj-name">Nom</Label>
        <Input id="proj-name" aria-invalid={errors.name ? true : undefined} {...register('name')} />
        <FormFieldError message={errors.name?.message} />
      </div>

      <div className="space-y-2">
        <Label htmlFor="proj-description">Description</Label>
        <Textarea id="proj-description" rows={3} {...register('description')} />
      </div>

      <div className="space-y-2">
        <Label htmlFor="proj-url">Lien</Label>
        <Input id="proj-url" type="url" aria-invalid={errors.url ? true : undefined} {...register('url')} />
        <FormFieldError message={errors.url?.message} />
      </div>

      <div className="space-y-2">
        <Label htmlFor="proj-technologies">Technologies</Label>
        <Input id="proj-technologies" {...register('technologies')} />
        <p className="text-muted-foreground text-sm">Séparez par des virgules.</p>
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
