import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type * as CvImportApi from '@/services/api/cv-import';
import { ImportCvPage } from './import-cv-page';

const fetchCvCapabilities = vi.hoisted(() => vi.fn());
vi.mock('@/services/api/cv-import', async () => {
  const actual = await vi.importActual<typeof CvImportApi>('@/services/api/cv-import');
  return { ...actual, fetchCvCapabilities };
});

function renderPage() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={client}>
      <MemoryRouter initialEntries={['/profile/import']}>
        <ImportCvPage />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

afterEach(() => fetchCvCapabilities.mockReset());

describe('ImportCvPage', () => {
  it("affiche l'en-tete et la zone de depot quand l_ia est configuree", async () => {
    fetchCvCapabilities.mockResolvedValue({ ai: true, maxSizeBytes: 10_000_000, acceptedTypes: ['application/pdf'] });
    renderPage();

    expect(screen.getByRole('heading', { name: 'Importer un CV' })).toBeInTheDocument();
    expect(await screen.findByLabelText('Choisir un fichier CV')).toBeInTheDocument();
  });

  it("affiche l'alerte IA non configuree, sans zone de depot, quand les capacites l_indiquent", async () => {
    fetchCvCapabilities.mockResolvedValue({ ai: false, maxSizeBytes: 10_000_000, acceptedTypes: [] });
    renderPage();

    expect(
      await screen.findByText(/L'analyse automatique n'est pas disponible pour le moment/),
    ).toBeInTheDocument();
    expect(screen.queryByLabelText('Choisir un fichier CV')).not.toBeInTheDocument();
  });
});
