import type { BaseResumeDto, CoverLetterDto, JobDetailDto } from '@jobtrack/shared';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ApiError } from '@/services/api/client';
import { CoverLetterPage } from './cover-letter-page';

const fetchJob = vi.hoisted(() => vi.fn());
vi.mock('@/services/api/jobs', () => ({
  fetchJob,
  fetchJobsCapabilities: vi.fn(),
  fetchSavedJobs: vi.fn(),
  saveJob: vi.fn(),
  unsaveJob: vi.fn(),
  searchCommunes: vi.fn(),
  searchJobs: vi.fn(),
}));

const fetchBaseResume = vi.hoisted(() => vi.fn());
const createLetter = vi.hoisted(() => vi.fn());
const fetchLetter = vi.hoisted(() => vi.fn());
const updateLetter = vi.hoisted(() => vi.fn());
const deleteLetter = vi.hoisted(() => vi.fn());
vi.mock('@/services/api/resume', () => ({
  fetchBaseResume,
  updateResumeTemplate: vi.fn(),
  fetchResumes: vi.fn(),
  tailorResume: vi.fn(),
  fetchResume: vi.fn(),
  updateResume: vi.fn(),
  deleteResume: vi.fn(),
  fetchLetters: vi.fn(),
  createLetter,
  fetchLetter,
  updateLetter,
  deleteLetter,
}));

const pdfMock = vi.hoisted(() => vi.fn());
vi.mock('@react-pdf/renderer', () => ({ pdf: pdfMock }));
vi.mock('../templates/letter/letter.pdf', () => ({ Pdf: () => null }));

function makeJob(overrides: Partial<JobDetailDto> = {}): JobDetailDto {
  return {
    id: 'job-1',
    title: 'Développeuse React',
    company: 'Piloto Software',
    companyLogoUrl: null,
    locationLabel: 'Metz (57)',
    departmentCode: '57',
    contractType: 'CDI',
    contractLabel: 'CDI',
    remoteMode: null,
    remoteModeInferred: false,
    experienceLevel: null,
    salaryMinAnnual: null,
    salaryMaxAnnual: null,
    salaryLabel: null,
    currency: 'EUR',
    publishedAt: '2026-09-01T00:00:00.000Z',
    expiredAt: null,
    description: "Description de l'offre.",
    companyDescription: null,
    companyUrl: null,
    communeCode: '57463',
    postalCode: '57000',
    latitude: null,
    longitude: null,
    contractNature: null,
    experienceLabel: null,
    experienceRequired: null,
    workingTimeLabel: null,
    isFullTime: null,
    isApprenticeship: false,
    positionsCount: null,
    accessibleTh: null,
    sectorLabel: null,
    romeCode: null,
    romeLabel: null,
    qualificationLabel: null,
    sourceUpdatedAt: null,
    lastSeenAt: '2026-09-01T00:00:00.000Z',
    skills: [],
    sources: [],
    requirements: [],
    saved: false,
    match: null,
    ...overrides,
  };
}

function makeBaseResume(overrides: Partial<BaseResumeDto> = {}): BaseResumeDto {
  return {
    template: 'CLASSIC',
    profileComplete: true,
    content: {
      schemaVersion: 1,
      identity: { firstName: 'Alice', lastName: 'Martin', title: null, city: 'Metz' },
      summary: 'Résumé du profil.',
      experiences: [],
      educations: [],
      skills: [],
      languages: [],
      certifications: [],
      projects: [],
    },
    ...overrides,
  };
}

function makeLetter(overrides: Partial<CoverLetterDto> = {}): CoverLetterDto {
  return {
    id: 'letter-1',
    jobId: 'job-1',
    jobTitle: 'Développeuse React',
    company: 'Piloto Software',
    resumeId: null,
    tone: 'PROFESSIONAL',
    createdAt: '2026-09-01T00:00:00.000Z',
    updatedAt: '2026-09-01T00:00:00.000Z',
    content: {
      recipient: null,
      subject: 'Candidature — Développeuse React',
      greeting: 'Madame, Monsieur,',
      paragraphs: ['Premier paragraphe de la lettre.'],
      closing: 'Cordialement,',
      signature: 'Alice Martin',
    },
    ...overrides,
  };
}

afterEach(() => {
  fetchJob.mockReset();
  fetchBaseResume.mockReset();
  createLetter.mockReset();
  fetchLetter.mockReset();
  updateLetter.mockReset();
  deleteLetter.mockReset();
  pdfMock.mockReset();
});

function renderPage(search = '') {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={client}>
      <MemoryRouter initialEntries={[`/resume/letter/job-1${search}`]}>
        <Routes>
          <Route path="/resume/letter/:jobId" element={<CoverLetterPage />} />
          <Route path="/resume" element={<p>Page Mon CV</p>} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  );
  return client;
}

describe('CoverLetterPage — generation', () => {
  it('appelle createLetter avec le ton choisi puis navigue vers la lettre creee', async () => {
    fetchJob.mockResolvedValue(makeJob());
    fetchBaseResume.mockResolvedValue(makeBaseResume());
    createLetter.mockResolvedValue(makeLetter({ id: 'letter-2', tone: 'SHORT' }));
    fetchLetter.mockResolvedValue(makeLetter({ id: 'letter-2', tone: 'SHORT' }));

    const user = userEvent.setup();
    renderPage();

    expect(await screen.findByRole('radio', { name: /courte/i })).toBeInTheDocument();
    await user.click(screen.getByRole('radio', { name: /courte/i }));
    await user.click(screen.getByRole('button', { name: 'Générer la lettre' }));

    await waitFor(() => expect(createLetter).toHaveBeenCalledWith({ jobId: 'job-1', tone: 'SHORT' }));
    expect(await screen.findByLabelText('Objet')).toHaveValue('Candidature — Développeuse React');
  });

  it("affiche l etat IA non configuree et masque le choix de ton", async () => {
    fetchJob.mockResolvedValue(makeJob());
    fetchBaseResume.mockResolvedValue(makeBaseResume());
    createLetter.mockRejectedValue(new ApiError("Le service IA n'est pas configuré.", 503, 'AI_NOT_CONFIGURED'));

    const user = userEvent.setup();
    renderPage();

    await user.click(await screen.findByRole('button', { name: 'Générer la lettre' }));

    expect(await screen.findByText("Le service IA n'est pas configuré.")).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Générer la lettre' })).not.toBeInTheDocument();
  });

  it('affiche un bandeau profil incomplet sans proposer de generer', async () => {
    fetchJob.mockResolvedValue(makeJob());
    fetchBaseResume.mockResolvedValue(makeBaseResume({ profileComplete: false }));

    renderPage();

    expect(await screen.findByText('Complétez votre profil pour générer une lettre.')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Générer la lettre' })).not.toBeInTheDocument();
    expect(createLetter).not.toHaveBeenCalled();
  });
});

describe('CoverLetterPage — lettre existante', () => {
  it("affiche l editeur et l apercu d une lettre existante", async () => {
    fetchJob.mockResolvedValue(makeJob());
    fetchBaseResume.mockResolvedValue(makeBaseResume());
    fetchLetter.mockResolvedValue(makeLetter());

    renderPage('?lettre=letter-1');

    expect(await screen.findByLabelText('Objet')).toHaveValue('Candidature — Développeuse React');
    expect(screen.getByRole('group', { name: /aperçu de la lettre/i })).toBeInTheDocument();
    expect(screen.getByText('Objet : Candidature — Développeuse React')).toBeInTheDocument();
  });

  it('enregistre le contenu edite via updateLetter', async () => {
    fetchJob.mockResolvedValue(makeJob());
    fetchBaseResume.mockResolvedValue(makeBaseResume());
    fetchLetter.mockResolvedValue(makeLetter());
    updateLetter.mockResolvedValue(makeLetter({ content: { ...makeLetter().content, subject: 'Nouvel objet' } }));

    const user = userEvent.setup();
    renderPage('?lettre=letter-1');

    const subjectInput = await screen.findByLabelText('Objet');
    await user.clear(subjectInput);
    await user.type(subjectInput, 'Nouvel objet');
    await user.click(screen.getByRole('button', { name: 'Enregistrer' }));

    await waitFor(() =>
      expect(updateLetter).toHaveBeenCalledWith(
        'letter-1',
        expect.objectContaining({ content: expect.objectContaining({ subject: 'Nouvel objet' }) }),
      ),
    );
  });

  it('affiche un avertissement quand le texte assemble depasse la borne du ton', async () => {
    fetchJob.mockResolvedValue(makeJob());
    fetchBaseResume.mockResolvedValue(makeBaseResume());
    fetchLetter.mockResolvedValue(makeLetter({ tone: 'SHORT', content: { ...makeLetter().content, paragraphs: ['x'.repeat(950)] } }));

    renderPage('?lettre=letter-1');

    expect(await screen.findByText(/950 \/ 900 caractères/)).toBeInTheDocument();
    expect(screen.getByText(/au-delà de la longueur recommandée/)).toBeInTheDocument();
  });

  it('genere le pdf avec le nom de fichier attendu au telechargement', async () => {
    fetchJob.mockResolvedValue(makeJob());
    fetchBaseResume.mockResolvedValue(makeBaseResume());
    fetchLetter.mockResolvedValue(makeLetter());
    pdfMock.mockReturnValue({ toBlob: () => Promise.resolve(new Blob(['contenu'])) });
    const createObjectURL = vi.fn().mockReturnValue('blob:mock-url');
    const revokeObjectURL = vi.fn();
    vi.stubGlobal('URL', { ...URL, createObjectURL, revokeObjectURL });
    let downloadedFileName: string | null = null;
    vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(function mockClick(this: HTMLAnchorElement) {
      downloadedFileName = this.download;
    });

    const user = userEvent.setup();
    renderPage('?lettre=letter-1');

    await user.click(await screen.findByRole('button', { name: /télécharger le pdf/i }));

    await waitFor(() => expect(downloadedFileName).toBe('Lettre-Alice-Martin-Piloto-Software.pdf'));
    vi.unstubAllGlobals();
  });

  it('supprime la lettre et navigue vers Mon CV', async () => {
    fetchJob.mockResolvedValue(makeJob());
    fetchBaseResume.mockResolvedValue(makeBaseResume());
    fetchLetter.mockResolvedValue(makeLetter());
    deleteLetter.mockResolvedValue(undefined);

    const user = userEvent.setup();
    renderPage('?lettre=letter-1');

    await user.click(await screen.findByRole('button', { name: 'Supprimer' }));
    const dialog = await screen.findByRole('dialog');
    await user.click(within(dialog).getByRole('button', { name: 'Supprimer' }));

    await waitFor(() => expect(deleteLetter).toHaveBeenCalledWith('letter-1'));
    expect(await screen.findByText('Page Mon CV')).toBeInTheDocument();
  });
});
