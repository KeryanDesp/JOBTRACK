import type { ApplicationDetailDto, CoverLetterSummaryDto, ResumeSummaryDto } from '@jobtrack/shared';
import { APPLICATION_STATUS_LABELS } from '@jobtrack/shared';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { ApiError } from '@/services/api/client';
import { ApplicationFormDialog, type ApplicationFormJob } from './application-form-dialog';

const createApplicationApi = vi.hoisted(() => vi.fn());

vi.mock('@/services/api/applications', () => ({
  fetchApplications: vi.fn(),
  fetchApplicationStats: vi.fn(),
  fetchApplicationBoard: vi.fn(),
  fetchApplication: vi.fn(),
  createApplication: createApplicationApi,
  updateApplication: vi.fn(),
  moveApplication: vi.fn(),
  deleteApplication: vi.fn(),
}));

const fetchResumes = vi.hoisted(() => vi.fn());
const fetchLetters = vi.hoisted(() => vi.fn());

vi.mock('@/services/api/resume', () => ({
  fetchResumes,
  fetchLetters,
  fetchBaseResume: vi.fn(),
  fetchResume: vi.fn(),
  fetchLetter: vi.fn(),
  tailorResume: vi.fn(),
  updateResume: vi.fn(),
  updateResumeTemplate: vi.fn(),
  deleteResume: vi.fn(),
  createLetter: vi.fn(),
  updateLetter: vi.fn(),
  deleteLetter: vi.fn(),
}));

beforeAll(() => {
  Element.prototype.scrollIntoView = vi.fn();
});

function makeResume(overrides: Partial<ResumeSummaryDto> = {}): ResumeSummaryDto {
  return {
    id: 'r1',
    title: 'CV Business Analyst',
    jobId: 'job_1',
    jobTitle: 'Business Analyst',
    company: 'Societe Generale',
    template: 'CLASSIC',
    currentVersion: 1,
    createdAt: '2026-09-10T08:00:00.000Z',
    updatedAt: '2026-09-10T08:00:00.000Z',
    ...overrides,
  };
}

function makeLetter(overrides: Partial<CoverLetterSummaryDto> = {}): CoverLetterSummaryDto {
  return {
    id: 'l1',
    jobId: 'job_1',
    jobTitle: 'Business Analyst',
    company: 'Societe Generale',
    resumeId: 'r1',
    tone: 'PROFESSIONAL',
    createdAt: '2026-09-12T08:00:00.000Z',
    updatedAt: '2026-09-12T08:00:00.000Z',
    ...overrides,
  };
}

function makeCreated(): ApplicationDetailDto {
  return {
    id: 'app_new',
    jobId: null,
    status: 'TO_APPLY',
    position: 0,
    jobTitle: 'Business Analyst',
    company: 'Societe Generale',
    locationLabel: null,
    salaryLabel: null,
    contractLabel: null,
    source: 'LINKEDIN',
    sourceUrl: null,
    appliedAt: null,
    usedBaseResume: false,
    resumeId: null,
    coverLetterId: null,
    notes: null,
    createdAt: '2026-09-17T08:00:00.000Z',
    updatedAt: '2026-09-17T08:00:00.000Z',
    job: null,
    resume: null,
    coverLetter: null,
    events: [],
  };
}

beforeEach(() => {
  fetchResumes.mockResolvedValue([makeResume()]);
  fetchLetters.mockResolvedValue([makeLetter()]);
  createApplicationApi.mockResolvedValue(makeCreated());
});

afterEach(() => {
  fetchResumes.mockReset();
  fetchLetters.mockReset();
  createApplicationApi.mockReset();
});

interface RenderOptions {
  job?: ApplicationFormJob;
  onCreated?: (application: ApplicationDetailDto) => void;
  onOpenApplication?: (id: string) => void;
  onOpenChange?: (open: boolean) => void;
}

function renderDialog(options: RenderOptions = {}) {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });

  return render(
    <MemoryRouter>
      <QueryClientProvider client={queryClient}>
        <ApplicationFormDialog
          open
          onOpenChange={options.onOpenChange ?? vi.fn()}
          job={options.job}
          onCreated={options.onCreated ?? vi.fn()}
          onOpenApplication={options.onOpenApplication ?? vi.fn()}
        />
      </QueryClientProvider>
    </MemoryRouter>,
  );
}

async function chooseOption(user: ReturnType<typeof userEvent.setup>, comboboxName: string, optionName: string) {
  await user.click(screen.getByRole('combobox', { name: comboboxName }));
  await user.click(await screen.findByRole('option', { name: optionName }));
}

const JOB: ApplicationFormJob = {
  id: 'job_1',
  title: 'Business Analyst',
  company: 'Societe Generale',
  tailoredResumes: [makeResume()],
};

describe('ApplicationFormDialog en mode manuel', () => {
  it('refuse de soumettre sans poste', async () => {
    const user = userEvent.setup();
    renderDialog();

    await user.click(screen.getByRole('button', { name: 'Ajouter' }));

    expect(await screen.findByRole('alert')).toHaveTextContent('Ce champ est obligatoire.');
    expect(createApplicationApi).not.toHaveBeenCalled();
  });

  it('envoie les champs saisis, source et statut par defaut compris', async () => {
    const user = userEvent.setup();
    renderDialog();

    await user.type(screen.getByLabelText('Poste *'), 'Business Analyst');
    await user.type(screen.getByLabelText('Entreprise'), 'Societe Generale');
    await user.click(screen.getByRole('button', { name: 'Ajouter' }));

    await waitFor(() => expect(createApplicationApi).toHaveBeenCalledTimes(1));
    expect(createApplicationApi.mock.calls[0]?.[0]).toMatchObject({
      jobTitle: 'Business Analyst',
      company: 'Societe Generale',
      source: 'OTHER',
      status: 'TO_APPLY',
      appliedAt: null,
      resumeId: null,
      usedBaseResume: false,
    });
  });

  it('n_affiche la date qu_une fois le statut sorti de A postuler, et la transmet', async () => {
    const user = userEvent.setup();
    renderDialog();

    expect(screen.queryByLabelText('Date de candidature')).not.toBeInTheDocument();

    await user.type(screen.getByLabelText('Poste *'), 'Business Analyst');
    await chooseOption(user, 'Statut', APPLICATION_STATUS_LABELS.INTERVIEW);
    const dateInput = await screen.findByLabelText('Date de candidature');
    await user.type(dateInput, '2026-09-15');
    await user.click(screen.getByRole('button', { name: 'Ajouter' }));

    await waitFor(() => expect(createApplicationApi).toHaveBeenCalledTimes(1));
    expect(createApplicationApi.mock.calls[0]?.[0]).toMatchObject({ status: 'INTERVIEW', appliedAt: '2026-09-15' });
  });

  it('traduit le choix CV principal en usedBaseResume', async () => {
    const user = userEvent.setup();
    renderDialog();

    await user.type(screen.getByLabelText('Poste *'), 'Business Analyst');
    await chooseOption(user, 'CV utilisé', 'CV principal');
    await user.click(screen.getByRole('button', { name: 'Ajouter' }));

    await waitFor(() => expect(createApplicationApi).toHaveBeenCalledTimes(1));
    expect(createApplicationApi.mock.calls[0]?.[0]).toMatchObject({ resumeId: null, usedBaseResume: true });
  });

  it('propose chaque CV de l_utilisateur et transmet son identifiant', async () => {
    const user = userEvent.setup();
    renderDialog();

    await user.type(screen.getByLabelText('Poste *'), 'Business Analyst');
    await chooseOption(user, 'CV utilisé', 'CV Business Analyst');
    await user.click(screen.getByRole('button', { name: 'Ajouter' }));

    await waitFor(() => expect(createApplicationApi).toHaveBeenCalledTimes(1));
    expect(createApplicationApi.mock.calls[0]?.[0]).toMatchObject({ resumeId: 'r1', usedBaseResume: false });
  });

  it('refuse un lien d_offre qui n_est pas http(s)', async () => {
    const user = userEvent.setup();
    renderDialog();

    await user.type(screen.getByLabelText('Poste *'), 'Business Analyst');
    await user.type(screen.getByLabelText("Lien de l'offre"), 'javascript:alert(1)');
    await user.click(screen.getByRole('button', { name: 'Ajouter' }));

    expect(await screen.findByRole('alert')).toHaveTextContent('Lien invalide (http ou https).');
    expect(createApplicationApi).not.toHaveBeenCalled();
  });

  it('reporte sur le champ concerne une erreur de validation du serveur', async () => {
    const user = userEvent.setup();
    createApplicationApi.mockRejectedValue(
      new ApiError('Requête invalide.', 400, 'VALIDATION_ERROR', { jobTitle: 'Titre déjà utilisé.' }),
    );
    renderDialog();

    await user.type(screen.getByLabelText('Poste *'), 'Business Analyst');
    await user.click(screen.getByRole('button', { name: 'Ajouter' }));

    expect(await screen.findByText('Titre déjà utilisé.')).toBeInTheDocument();
  });

  it('reporte sous le selecteur CV une erreur serveur sur resumeId/usedBaseResume', async () => {
    const user = userEvent.setup();
    createApplicationApi.mockRejectedValue(
      new ApiError('Requête invalide.', 400, 'VALIDATION_ERROR', {
        resumeId: 'Choisissez soit le CV principal, soit un CV adapté.',
      }),
    );
    renderDialog();

    await user.type(screen.getByLabelText('Poste *'), 'Business Analyst');
    await user.click(screen.getByRole('button', { name: 'Ajouter' }));

    const message = await screen.findByText('Choisissez soit le CV principal, soit un CV adapté.');
    expect(message).toBeInTheDocument();
    expect(screen.getByRole('combobox', { name: 'CV utilisé' })).toHaveAttribute('aria-describedby', message.id);
    expect(screen.getByRole('combobox', { name: 'CV utilisé' })).toHaveAttribute('aria-invalid', 'true');
  });
});

describe('ApplicationFormDialog en mode offre', () => {
  it('n_affiche que les champs courts et transmet le jobId', async () => {
    const user = userEvent.setup();
    renderDialog({ job: JOB });

    expect(screen.queryByLabelText('Poste *')).not.toBeInTheDocument();
    expect(screen.getByLabelText('Statut')).toBeInTheDocument();
    expect(screen.getByLabelText('Lettre')).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Suivre cette candidature' }));

    await waitFor(() => expect(createApplicationApi).toHaveBeenCalledTimes(1));
    expect(createApplicationApi.mock.calls[0]?.[0]).toMatchObject({
      jobId: 'job_1',
      status: 'TO_APPLY',
      // `JOB` porte un CV adapté (préselectionné, voir tests dédiés ci-dessous) :
      // non touché ici, c'est donc lui qui part avec la candidature.
      resumeId: 'r1',
      usedBaseResume: false,
      coverLetterId: null,
    });
  });

  it('preselectionne le cv adapte le plus recent de l_offre dans CV utilise', () => {
    renderDialog({ job: JOB });

    expect(screen.getByRole('combobox', { name: 'CV utilisé' })).toHaveTextContent('CV Business Analyst');
  });

  it('n_affiche aucun cv preselectionne quand l_offre n_en a aucun', () => {
    renderDialog({ job: { ...JOB, tailoredResumes: [] } });

    expect(screen.getByRole('combobox', { name: 'CV utilisé' })).toHaveTextContent('Aucun');
  });

  it('la preselection du cv le plus recent n_empeche pas de revenir a Aucun', async () => {
    const user = userEvent.setup();
    renderDialog({ job: JOB });

    await chooseOption(user, 'CV utilisé', 'Aucun');
    await user.click(screen.getByRole('button', { name: 'Suivre cette candidature' }));

    await waitFor(() => expect(createApplicationApi).toHaveBeenCalledTimes(1));
    expect(createApplicationApi.mock.calls[0]?.[0]).toMatchObject({ resumeId: null, usedBaseResume: false });
  });

  it('propose les CV adaptes de cette offre puis la lettre de cette offre', async () => {
    const user = userEvent.setup();
    renderDialog({ job: JOB });

    await chooseOption(user, 'CV utilisé', 'CV Business Analyst');
    await user.click(screen.getByRole('combobox', { name: 'Lettre' }));
    await user.click(await screen.findByRole('option', { name: /Lettre du/ }));
    await user.click(screen.getByRole('button', { name: 'Suivre cette candidature' }));

    await waitFor(() => expect(createApplicationApi).toHaveBeenCalledTimes(1));
    expect(createApplicationApi.mock.calls[0]?.[0]).toMatchObject({ resumeId: 'r1', coverLetterId: 'l1' });
  });

  it('ferme le formulaire et ouvre la fiche existante sur un doublon', async () => {
    const user = userEvent.setup();
    const onOpenApplication = vi.fn();
    const onOpenChange = vi.fn();
    createApplicationApi.mockRejectedValue(
      new ApiError('Cette offre est déjà suivie.', 409, 'APPLICATION_EXISTS', { applicationId: 'app_42' }),
    );
    renderDialog({ job: JOB, onOpenApplication, onOpenChange });

    await user.click(screen.getByRole('button', { name: 'Suivre cette candidature' }));

    await waitFor(() => expect(onOpenApplication).toHaveBeenCalledWith('app_42'));
    expect(onOpenChange).toHaveBeenCalledWith(false);
  });

  it('reporte sous le selecteur Lettre une erreur serveur sur coverLetterId', async () => {
    const user = userEvent.setup();
    createApplicationApi.mockRejectedValue(
      new ApiError('Requête invalide.', 400, 'VALIDATION_ERROR', { coverLetterId: 'Lettre introuvable.' }),
    );
    renderDialog({ job: JOB });

    await user.click(screen.getByRole('button', { name: 'Suivre cette candidature' }));

    const message = await screen.findByText('Lettre introuvable.');
    expect(screen.getByRole('combobox', { name: 'Lettre' })).toHaveAttribute('aria-describedby', message.id);
  });

  it('previent du succes avec une action Voir vers la fiche creee', async () => {
    const user = userEvent.setup();
    const onCreated = vi.fn();
    renderDialog({ job: JOB, onCreated });

    await user.click(screen.getByRole('button', { name: 'Suivre cette candidature' }));

    await waitFor(() => expect(onCreated).toHaveBeenCalledWith(expect.objectContaining({ id: 'app_new' })));
  });
});
