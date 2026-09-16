import { skillSchema, type SkillFormInput } from '@jobtrack/shared';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { Sparkles } from 'lucide-react';
import { toast } from 'sonner';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type * as ProfileApi from '@/services/api/profile';
import { ApiError } from '@/services/api/client';
import { CollectionSection } from './collection-section';

const fetchCollection = vi.hoisted(() => vi.fn());
const reorderCollection = vi.hoisted(() => vi.fn());
vi.mock('@/services/api/profile', async () => {
  const actual = await vi.importActual<typeof ProfileApi>('@/services/api/profile');
  return {
    ...actual,
    fetchCollection,
    createItem: vi.fn(),
    updateItem: vi.fn(),
    deleteItem: vi.fn(),
    reorderCollection,
  };
});

afterEach(() => {
  fetchCollection.mockReset();
  reorderCollection.mockReset();
});

const defaultValues: SkillFormInput = { name: '', category: 'TECHNICAL', level: 'INTERMEDIATE' };

function renderSection() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
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

  it('descend le premier element et annule (avec toast) si le serveur refuse', async () => {
    const user = userEvent.setup();
    const errorToast = vi.spyOn(toast, 'error').mockImplementation(() => '');
    fetchCollection.mockResolvedValue([
      { id: 's1', sortOrder: 0, name: 'React', category: 'TECHNICAL', level: 'ADVANCED' },
      { id: 's2', sortOrder: 1, name: 'Anglais courant', category: 'SOFT', level: 'EXPERT' },
    ]);
    reorderCollection.mockRejectedValue(new ApiError('Connexion au serveur impossible.', 0));
    const { container } = renderSection();

    await screen.findByText('React');
    const [firstDescendre] = screen.getAllByRole('button', { name: 'Descendre' });
    if (!firstDescendre) throw new Error('Bouton "Descendre" introuvable.');
    await user.click(firstDescendre);

    await waitFor(() => {
      expect(reorderCollection).toHaveBeenCalledWith('skills', { ids: ['s2', 's1'] });
    });

    await waitFor(() => {
      const names = [...container.querySelectorAll('li')].map((item) => item.textContent);
      expect(names[0]).toContain('React');
    });
    expect(errorToast).toHaveBeenCalled();

    errorToast.mockRestore();
  });
});
