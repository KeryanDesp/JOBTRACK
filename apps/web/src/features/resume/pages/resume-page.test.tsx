import type { BaseResumeDto, CoverLetterSummaryDto, ResumeContent, ResumeSummaryDto } from '@jobtrack/shared';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ResumePage } from './resume-page';

const fetchBaseResume = vi.hoisted(() => vi.fn());
const updateResumeTemplate = vi.hoisted(() => vi.fn());
const fetchResumes = vi.hoisted(() => vi.fn());
const deleteResume = vi.hoisted(() => vi.fn());
const fetchLetters = vi.hoisted(() => vi.fn());
const deleteLetter = vi.hoisted(() => vi.fn());

vi.mock('@/services/api/resume', () => ({
  fetchBaseResume,
  updateResumeTemplate,
  fetchResumes,
  tailorResume: vi.fn(),
  fetchResume: vi.fn(),
  updateResume: vi.fn(),
  deleteResume,
  fetchLetters,
  createLetter: vi.fn(),
  fetchLetter: vi.fn(),
  updateLetter: vi.fn(),
  deleteLetter,
}));

function makeContent(overrides: Partial<ResumeContent> = {}): ResumeContent {
  return {
    schemaVersion: 1,
    identity: { firstName: 'Alice', lastName: 'Martin', title: 'Développeuse' },
    summary: 'Résumé professionnel.',
    experiences: [],
    educations: [],
    skills: [],
    languages: [],
    certifications: [],
    projects: [],
    ...overrides,
  };
}

function makeBaseResume(overrides: Partial<BaseResumeDto> = {}): BaseResumeDto {
  return { content: makeContent(), template: 'CLASSIC', profileComplete: true, ...overrides };
}

function makeResumeSummary(overrides: Partial<ResumeSummaryDto> = {}): ResumeSummaryDto {
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
    ...overrides,
  };
}

function makeLetterSummary(overrides: Partial<CoverLetterSummaryDto> = {}): CoverLetterSummaryDto {
  return {
    id: 'letter-1',
    jobId: 'job-1',
    jobTitle: 'Développeuse React',
    company: 'Piloto Software',
    resumeId: null,
    tone: 'PROFESSIONAL',
    createdAt: '2026-09-01T00:00:00.000Z',
    updatedAt: '2026-09-01T00:00:00.000Z',
    ...overrides,
  };
}

afterEach(() => {
  fetchBaseResume.mockReset();
  updateResumeTemplate.mockReset();
  fetchResumes.mockReset();
  deleteResume.mockReset();
  fetchLetters.mockReset();
  deleteLetter.mockReset();
});

function renderPage() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={client}>
      <MemoryRouter initialEntries={['/resume']}>
        <ResumePage />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

describe('ResumePage', () => {
  it('affiche l_apercu du CV principal, le selecteur de modele et le telechargement', async () => {
    fetchBaseResume.mockResolvedValue(makeBaseResume());
    fetchResumes.mockResolvedValue([]);
    fetchLetters.mockResolvedValue([]);
    renderPage();

    expect(await screen.findByText('Alice Martin')).toBeInTheDocument();
    expect(screen.getByRole('radio', { name: 'Classique' })).toHaveAttribute('data-state', 'checked');
    expect(screen.getByRole('button', { name: /télécharger le pdf/i })).toBeInTheDocument();
  });

  it('affiche un bandeau invitant a completer le profil quand il est incomplet', async () => {
    fetchBaseResume.mockResolvedValue(makeBaseResume({ profileComplete: false }));
    fetchResumes.mockResolvedValue([]);
    fetchLetters.mockResolvedValue([]);
    renderPage();

    expect(await screen.findByText('Complétez votre profil pour un CV exploitable.')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Compléter mon profil' })).toHaveAttribute('href', '/profile');
  });

  it('affiche l_etat vide des CV adaptes avec un lien vers les offres', async () => {
    fetchBaseResume.mockResolvedValue(makeBaseResume());
    fetchResumes.mockResolvedValue([]);
    fetchLetters.mockResolvedValue([]);
    renderPage();

    expect(await screen.findByText('Aucun CV adapté.')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Voir les offres' })).toHaveAttribute('href', '/jobs');
  });

  it('affiche l_etat vide des lettres', async () => {
    fetchBaseResume.mockResolvedValue(makeBaseResume());
    fetchResumes.mockResolvedValue([]);
    fetchLetters.mockResolvedValue([]);
    renderPage();

    expect(await screen.findByText('Aucune lettre.')).toBeInTheDocument();
  });

  it('affiche une lettre existante avec son lien Ouvrir', async () => {
    fetchBaseResume.mockResolvedValue(makeBaseResume());
    fetchResumes.mockResolvedValue([]);
    fetchLetters.mockResolvedValue([makeLetterSummary()]);
    renderPage();

    expect(await screen.findByText('Développeuse React')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Ouvrir' })).toHaveAttribute('href', '/resume/letter/job-1?lettre=letter-1');
  });

  it('supprime un CV adapte apres confirmation', async () => {
    fetchBaseResume.mockResolvedValue(makeBaseResume());
    fetchResumes.mockResolvedValue([makeResumeSummary()]);
    fetchLetters.mockResolvedValue([]);
    deleteResume.mockResolvedValue(undefined);
    const user = userEvent.setup();
    renderPage();

    await screen.findByText('CV Développeuse React — Piloto Software');
    await user.click(screen.getByRole('button', { name: /supprimer cv développeuse react/i }));
    await user.click(screen.getByRole('button', { name: 'Supprimer' }));

    await waitFor(() => expect(deleteResume).toHaveBeenCalledWith('resume-1'));
  });
});
