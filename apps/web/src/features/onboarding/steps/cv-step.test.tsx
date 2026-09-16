import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type * as CvImportApi from '@/services/api/cv-import';
import { CvStep } from './cv-step';

const fetchCvCapabilities = vi.hoisted(() => vi.fn());
vi.mock('@/services/api/cv-import', async () => {
  const actual = await vi.importActual<typeof CvImportApi>('@/services/api/cv-import');
  return { ...actual, fetchCvCapabilities };
});

function renderStep() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={client}>
      <CvStep onExtracted={vi.fn()} onManual={vi.fn()} />
    </QueryClientProvider>,
  );
}

afterEach(() => fetchCvCapabilities.mockReset());

describe('CvStep', () => {
  it('affiche l_alerte IA non configuree quand les capacites l_indiquent, sans zone de depot', async () => {
    fetchCvCapabilities.mockResolvedValue({ ai: false, maxSizeBytes: 10_000_000, acceptedTypes: [] });
    renderStep();

    expect(
      await screen.findByText(/L'analyse automatique n'est pas disponible pour le moment/),
    ).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Remplir à la main' })).toBeInTheDocument();
    expect(screen.queryByLabelText('Choisir un fichier CV')).not.toBeInTheDocument();
  });

  it('affiche la zone de depot quand l_ia est configuree', async () => {
    fetchCvCapabilities.mockResolvedValue({ ai: true, maxSizeBytes: 10_000_000, acceptedTypes: ['application/pdf'] });
    renderStep();

    expect(await screen.findByLabelText('Choisir un fichier CV')).toBeInTheDocument();
    expect(screen.getByText('Je remplirai mon profil à la main')).toBeInTheDocument();
  });
});
