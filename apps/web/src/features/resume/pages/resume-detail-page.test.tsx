import type { ResumeDto } from '@jobtrack/shared';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ApiError } from '@/services/api/client';
import { ResumeDetailPage } from './resume-detail-page';

const fetchResume = vi.hoisted(() => vi.fn());
const updateResume = vi.hoisted(() => vi.fn());
const deleteResume = vi.hoisted(() => vi.fn());

vi.mock('@/services/api/resume', () => ({
  fetchBaseResume: vi.fn(),
  updateResumeTemplate: vi.fn(),
  fetchResumes: vi.fn(),
  tailorResume: vi.fn(),
  fetchResume,
  updateResume,
  deleteResume,
  fetchLetters: vi.fn(),
  createLetter: vi.fn(),
  fetchLetter: vi.fn(),
  updateLetter: vi.fn(),
  deleteLetter: vi.fn(),
}));

function makeResume(overrides: Partial<ResumeDto> = {}): ResumeDto {
  return {
    id: 'resume-1',
    title: 'CV Développeuse React — Piloto Software',
    jobId: 'job-1',
    jobTitle: 'Développeuse React',
    company: 'Piloto Software',
    template: 'CLASSIC',
    currentVersion: 1,
    createdAt: '2026-09-01T00:00:00.000Z',
    updatedAt: '2026-09-01T00:00:00.000Z',
    content: {
      schemaVersion: 1,
      identity: { firstName: 'Alice', lastName: 'Martin', title: null },
      summary: 'Résumé initial.',
      experiences: [],
      educations: [],
      skills: [],
      languages: [],
      certifications: [],
      projects: [],
    },
    changes: {
      title: { before: '', after: 'Développeuse React confirmée' },
      summary: { before: 'Résumé du profil.', after: 'Résumé initial.' },
      experiences: [],
      skills: { before: [], after: [] },
      educations: { kept: [], removed: [] },
      certifications: { kept: [], removed: [] },
      projects: { kept: [], removed: [] },
      notes: null,
    },
    version: { number: 1, source: 'AI', model: 'claude', promptVersion: 1, createdAt: '2026-09-01T00:00:00.000Z' },
    ...overrides,
  };
}

afterEach(() => {
  fetchResume.mockReset();
  updateResume.mockReset();
  deleteResume.mockReset();
});

function renderPage(id = 'resume-1') {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={client}>
      <MemoryRouter initialEntries={[`/resume/${id}`]}>
        <Routes>
          <Route path="/resume/:id" element={<ResumeDetailPage />} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

describe('ResumeDetailPage', () => {
  it('affiche les onglets Apercu, Modifications et Modifier', async () => {
    fetchResume.mockResolvedValue(makeResume());
    renderPage();

    expect(await screen.findByRole('heading', { name: 'CV Développeuse React — Piloto Software' })).toBeInTheDocument();
    expect(screen.getByRole('tab', { name: 'Aperçu' })).toBeInTheDocument();
    expect(screen.getByRole('tab', { name: 'Modifications' })).toBeInTheDocument();
    expect(screen.getByRole('tab', { name: 'Modifier' })).toBeInTheDocument();
  });

  it("n_affiche pas l_onglet Modifications quand le CV n_a pas de changements (version USER)", async () => {
    fetchResume.mockResolvedValue(makeResume({ changes: null, version: { number: 2, source: 'USER', model: null, promptVersion: null, createdAt: '2026-09-02T00:00:00.000Z' } }));
    renderPage();

    await screen.findByRole('heading', { name: 'CV Développeuse React — Piloto Software' });
    expect(screen.queryByRole('tab', { name: 'Modifications' })).not.toBeInTheDocument();
  });

  it('modifie le resume dans l_onglet Modifier puis Enregistrer appelle updateResume avec un contenu valide', async () => {
    fetchResume.mockResolvedValue(makeResume());
    updateResume.mockResolvedValue(makeResume({ content: { ...makeResume().content, summary: 'Résumé modifié.' } }));
    const user = userEvent.setup();
    renderPage();

    await screen.findByRole('heading', { name: 'CV Développeuse React — Piloto Software' });
    await user.click(screen.getByRole('tab', { name: 'Modifier' }));

    const summaryField = await screen.findByLabelText('Résumé');
    await user.clear(summaryField);
    await user.type(summaryField, 'Résumé modifié.');

    await user.click(screen.getByRole('button', { name: 'Enregistrer' }));

    await waitFor(() => expect(updateResume).toHaveBeenCalledTimes(1));
    const [, input] = updateResume.mock.calls[0] as [string, { content: { summary: string } }];
    expect(input.content.summary).toBe('Résumé modifié.');
  });

  it('affiche un message CV introuvable sur une 404', async () => {
    fetchResume.mockRejectedValue(new ApiError('CV introuvable.', 404));
    renderPage();

    expect(await screen.findByText('CV introuvable.')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Retour à Mon CV' })).toHaveAttribute('href', '/resume');
  });

  it('supprime le CV apres confirmation', async () => {
    fetchResume.mockResolvedValue(makeResume());
    deleteResume.mockResolvedValue(undefined);
    const user = userEvent.setup();
    renderPage();

    await screen.findByRole('heading', { name: 'CV Développeuse React — Piloto Software' });
    await user.click(screen.getByRole('button', { name: 'Supprimer' }));
    const dialog = await screen.findByRole('dialog');
    await user.click(within(dialog).getByRole('button', { name: 'Supprimer' }));

    await waitFor(() => expect(deleteResume).toHaveBeenCalledWith('resume-1'));
  });
});
