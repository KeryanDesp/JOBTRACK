import { skillSchema, type SkillFormInput } from '@jobtrack/shared';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen } from '@testing-library/react';
import { Sparkles } from 'lucide-react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type * as ProfileApi from '@/services/api/profile';
import { ApiError } from '@/services/api/client';
import { CollectionSection } from './collection-section';

const fetchCollection = vi.hoisted(() => vi.fn());
vi.mock('@/services/api/profile', async () => {
  const actual = await vi.importActual<typeof ProfileApi>('@/services/api/profile');
  return {
    ...actual,
    fetchCollection,
    createItem: vi.fn(),
    updateItem: vi.fn(),
    deleteItem: vi.fn(),
    reorderCollection: vi.fn(),
  };
});

afterEach(() => fetchCollection.mockReset());

const defaultValues: SkillFormInput = { name: '', category: 'TECHNICAL', level: 'INTERMEDIATE' };

function renderSection() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={client}>
      <CollectionSection
        name="skills"
        title="Compétences"
        description="Vos compétences techniques et humaines."
        icon={Sparkles}
        emptyLabel="Aucune compétence ajoutée."
        addLabel="Ajouter une compétence"
        deleteLabel="Supprimer cette compétence"
        schema={skillSchema}
        defaultValues={defaultValues}
        normalize={(raw) => raw}
        toFormValues={(item) => ({ name: item.name, category: item.category, level: item.level })}
        renderSummary={(item) => <span>{item.name}</span>}
        renderFields={(form) => <input aria-label="Nom" {...form.register('name')} />}
      />
    </QueryClientProvider>,
  );
}

describe('CollectionSection', () => {
  it("affiche l'état vide quand la collection ne contient aucun élément", async () => {
    fetchCollection.mockResolvedValue([]);
    renderSection();

    expect(await screen.findByText('Aucune compétence ajoutée.')).toBeInTheDocument();
  });

  it('affiche les éléments existants', async () => {
    fetchCollection.mockResolvedValue([
      { id: 's1', sortOrder: 0, name: 'React', category: 'TECHNICAL', level: 'ADVANCED' },
      { id: 's2', sortOrder: 1, name: 'Anglais courant', category: 'SOFT', level: 'EXPERT' },
    ]);
    renderSection();

    expect(await screen.findByText('React')).toBeInTheDocument();
    expect(screen.getByText('Anglais courant')).toBeInTheDocument();
  });

  it('affiche une erreur avec un bouton pour réessayer', async () => {
    fetchCollection.mockRejectedValue(new ApiError('Impossible de charger vos compétences.', 500));
    renderSection();

    expect(await screen.findByText('Impossible de charger vos compétences.')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Réessayer' })).toBeInTheDocument();
  });
});
