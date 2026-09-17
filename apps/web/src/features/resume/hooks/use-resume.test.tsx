import type { BaseResumeDto, CoverLetterDto, CoverLetterSummaryDto, ResumeDto, ResumeSummaryDto } from '@jobtrack/shared';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, renderHook, waitFor } from '@testing-library/react';
import type { ReactNode } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ApiError } from '@/services/api/client';
import { resumeKeys } from '../lib/query-keys';
import {
  useCreateLetter,
  useDeleteLetter,
  useDeleteResume,
  useResumeTemplate,
  useTailorResume,
  useUpdateLetter,
  useUpdateResume,
} from './use-resume';

const deleteResume = vi.hoisted(() => vi.fn());
const updateResumeTemplate = vi.hoisted(() => vi.fn());
const tailorResume = vi.hoisted(() => vi.fn());
const updateResume = vi.hoisted(() => vi.fn());
const createLetter = vi.hoisted(() => vi.fn());
const updateLetter = vi.hoisted(() => vi.fn());
const deleteLetter = vi.hoisted(() => vi.fn());
const toastError = vi.hoisted(() => vi.fn());

vi.mock('@/services/api/resume', () => ({
  fetchBaseResume: vi.fn(),
  updateResumeTemplate,
  fetchResumes: vi.fn(),
  fetchResume: vi.fn(),
  tailorResume,
  updateResume,
  deleteResume,
  fetchLetters: vi.fn(),
  fetchLetter: vi.fn(),
  createLetter,
  updateLetter,
  deleteLetter,
}));

vi.mock('sonner', () => ({ toast: { error: toastError, success: vi.fn() } }));

afterEach(() => {
  deleteResume.mockReset();
  updateResumeTemplate.mockReset();
  tailorResume.mockReset();
  updateResume.mockReset();
  createLetter.mockReset();
  updateLetter.mockReset();
  deleteLetter.mockReset();
  toastError.mockReset();
});

function makeClient(): QueryClient {
  return new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
}

function wrapperFor(client: QueryClient) {
  return ({ children }: { children: ReactNode }) => <QueryClientProvider client={client}>{children}</QueryClientProvider>;
}

function makeSummary(overrides: Partial<ResumeSummaryDto> = {}): ResumeSummaryDto {
  return {
    id: 'resume-1',
    title: 'CV Développeuse React — Piloto Software',
    jobId: 'job-1',
    jobTitle: 'Développeuse React',
    company: 'Piloto Software',
    template: 'CLASSIC',
    currentVersion: 1,
    createdAt: '2026-09-17T00:00:00.000Z',
    updatedAt: '2026-09-17T00:00:00.000Z',
    ...overrides,
  };
}

function makeBaseResumeContent() {
  return {
    schemaVersion: 1 as const,
    identity: { firstName: 'Alice', lastName: 'Martin', title: null },
    summary: '',
    experiences: [],
    educations: [],
    skills: [],
    languages: [],
    certifications: [],
    projects: [],
  };
}

function makeBaseResume(overrides: Partial<BaseResumeDto> = {}): BaseResumeDto {
  return {
    content: makeBaseResumeContent(),
    template: 'CLASSIC',
    profileComplete: true,
    ...overrides,
  };
}

function makeResumeDto(overrides: Partial<ResumeDto> = {}): ResumeDto {
  return {
    ...makeSummary(),
    content: makeBaseResumeContent(),
    changes: null,
    version: { number: 1, source: 'AI', model: 'claude', promptVersion: 1, createdAt: '2026-09-17T00:00:00.000Z' },
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
    createdAt: '2026-09-17T00:00:00.000Z',
    updatedAt: '2026-09-17T00:00:00.000Z',
    ...overrides,
  };
}

function makeLetterDto(overrides: Partial<CoverLetterDto> = {}): CoverLetterDto {
  return {
    ...makeLetterSummary(),
    content: { recipient: null, subject: 'Candidature', greeting: 'Bonjour,', paragraphs: ['Texte.'], closing: 'Cordialement,', signature: 'Alice' },
    ...overrides,
  };
}

describe('useDeleteResume', () => {
  it('retire la version de la liste en cache avant la reponse serveur (optimiste)', async () => {
    deleteResume.mockImplementation(() => new Promise((resolve) => setTimeout(resolve, 20)));
    const client = makeClient();
    client.setQueryData(resumeKeys.list, [makeSummary({ id: 'resume-1' }), makeSummary({ id: 'resume-2' })]);

    const { result } = renderHook(() => useDeleteResume(), { wrapper: wrapperFor(client) });
    act(() => result.current.mutate('resume-1'));

    await waitFor(() => {
      const list = client.getQueryData<ResumeSummaryDto[]>(resumeKeys.list);
      expect(list?.map((item) => item.id)).toEqual(['resume-2']);
    });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
  });

  it('restaure la liste et affiche un toast quand la suppression echoue', async () => {
    deleteResume.mockRejectedValue(new ApiError('Suppression impossible.', 404));
    const client = makeClient();
    client.setQueryData(resumeKeys.list, [makeSummary({ id: 'resume-1' })]);

    const { result } = renderHook(() => useDeleteResume(), { wrapper: wrapperFor(client) });
    act(() => result.current.mutate('resume-1'));

    await waitFor(() => expect(result.current.isError).toBe(true));
    const list = client.getQueryData<ResumeSummaryDto[]>(resumeKeys.list);
    expect(list?.map((item) => item.id)).toEqual(['resume-1']);
    expect(toastError).toHaveBeenCalledWith('Suppression impossible.');
  });

  it('purge le detail en cache apres la suppression (revue finale item 1)', async () => {
    deleteResume.mockResolvedValue(undefined);
    const client = makeClient();
    client.setQueryData(resumeKeys.list, [makeSummary({ id: 'resume-1' })]);
    client.setQueryData(resumeKeys.detail('resume-1'), makeResumeDto({ id: 'resume-1' }));

    const { result } = renderHook(() => useDeleteResume(), { wrapper: wrapperFor(client) });
    act(() => result.current.mutate('resume-1'));

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(client.getQueryData(resumeKeys.detail('resume-1'))).toBeUndefined();
  });
});

describe('useResumeTemplate', () => {
  it('applique le nouveau modele au cv principal en cache avant la reponse serveur', async () => {
    updateResumeTemplate.mockImplementation(
      (input: { template: 'CLASSIC' | 'MODERN' }) => new Promise((resolve) => setTimeout(() => resolve(makeBaseResume(input)), 20)),
    );
    const client = makeClient();
    client.setQueryData(resumeKeys.base, makeBaseResume({ template: 'CLASSIC' }));

    const { result } = renderHook(() => useResumeTemplate(), { wrapper: wrapperFor(client) });
    act(() => result.current.mutate({ template: 'MODERN' }));

    await waitFor(() => {
      expect(client.getQueryData<BaseResumeDto>(resumeKeys.base)?.template).toBe('MODERN');
    });
  });

  it('restaure le modele precedent quand la mise a jour echoue', async () => {
    updateResumeTemplate.mockRejectedValue(new ApiError('Le modèle est invalide.', 400));
    const client = makeClient();
    client.setQueryData(resumeKeys.base, makeBaseResume({ template: 'CLASSIC' }));

    const { result } = renderHook(() => useResumeTemplate(), { wrapper: wrapperFor(client) });
    act(() => result.current.mutate({ template: 'MODERN' }));

    await waitFor(() => expect(result.current.isError).toBe(true));
    expect(client.getQueryData<BaseResumeDto>(resumeKeys.base)?.template).toBe('CLASSIC');
    expect(toastError).toHaveBeenCalledWith('Le modèle est invalide.');
  });
});

describe('useUpdateResume', () => {
  it('place la nouvelle version en cache au succes', async () => {
    const updated = makeResumeDto({ version: { number: 2, source: 'USER', model: null, promptVersion: null, createdAt: '2026-09-17T00:00:00.000Z' } });
    updateResume.mockResolvedValue(updated);
    const client = makeClient();

    const { result } = renderHook(() => useUpdateResume('resume-1'), { wrapper: wrapperFor(client) });
    act(() => result.current.mutate({ content: makeBaseResumeContent() }));

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(client.getQueryData(resumeKeys.detail('resume-1'))).toEqual(updated);
  });

  it('affiche un toast quand l enregistrement echoue', async () => {
    updateResume.mockRejectedValue(new ApiError('Contenu invalide.', 400));
    const client = makeClient();

    const { result } = renderHook(() => useUpdateResume('resume-1'), { wrapper: wrapperFor(client) });
    act(() => result.current.mutate({ content: makeBaseResumeContent() }));

    await waitFor(() => expect(result.current.isError).toBe(true));
    expect(toastError).toHaveBeenCalledWith('Contenu invalide.');
  });
});

describe('useUpdateLetter', () => {
  it('place la lettre mise a jour en cache au succes', async () => {
    const updated = makeLetterDto();
    updateLetter.mockResolvedValue(updated);
    const client = makeClient();

    const { result } = renderHook(() => useUpdateLetter('letter-1'), { wrapper: wrapperFor(client) });
    act(() => result.current.mutate({ content: updated.content }));

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(client.getQueryData(resumeKeys.letter('letter-1'))).toEqual(updated);
  });

  it('affiche un toast quand l enregistrement echoue', async () => {
    updateLetter.mockRejectedValue(new ApiError('Contenu invalide.', 400));
    const client = makeClient();

    const { result } = renderHook(() => useUpdateLetter('letter-1'), { wrapper: wrapperFor(client) });
    act(() => result.current.mutate({ content: makeLetterDto().content }));

    await waitFor(() => expect(result.current.isError).toBe(true));
    expect(toastError).toHaveBeenCalledWith('Contenu invalide.');
  });
});

describe('useDeleteLetter', () => {
  it('retire la lettre de la liste en cache avant la reponse serveur (optimiste)', async () => {
    deleteLetter.mockImplementation(() => new Promise((resolve) => setTimeout(resolve, 20)));
    const client = makeClient();
    client.setQueryData(resumeKeys.letters, [makeLetterSummary({ id: 'letter-1' }), makeLetterSummary({ id: 'letter-2' })]);

    const { result } = renderHook(() => useDeleteLetter(), { wrapper: wrapperFor(client) });
    act(() => result.current.mutate('letter-1'));

    await waitFor(() => {
      const list = client.getQueryData<CoverLetterSummaryDto[]>(resumeKeys.letters);
      expect(list?.map((item) => item.id)).toEqual(['letter-2']);
    });
  });

  it('restaure la liste et affiche un toast quand la suppression echoue', async () => {
    deleteLetter.mockRejectedValue(new ApiError('Suppression impossible.', 404));
    const client = makeClient();
    client.setQueryData(resumeKeys.letters, [makeLetterSummary({ id: 'letter-1' })]);

    const { result } = renderHook(() => useDeleteLetter(), { wrapper: wrapperFor(client) });
    act(() => result.current.mutate('letter-1'));

    await waitFor(() => expect(result.current.isError).toBe(true));
    const list = client.getQueryData<CoverLetterSummaryDto[]>(resumeKeys.letters);
    expect(list?.map((item) => item.id)).toEqual(['letter-1']);
    expect(toastError).toHaveBeenCalledWith('Suppression impossible.');
  });

  it('purge le detail en cache apres la suppression (revue finale item 1)', async () => {
    deleteLetter.mockResolvedValue(undefined);
    const client = makeClient();
    client.setQueryData(resumeKeys.letters, [makeLetterSummary({ id: 'letter-1' })]);
    client.setQueryData(resumeKeys.letter('letter-1'), makeLetterDto({ id: 'letter-1' }));

    const { result } = renderHook(() => useDeleteLetter(), { wrapper: wrapperFor(client) });
    act(() => result.current.mutate('letter-1'));

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(client.getQueryData(resumeKeys.letter('letter-1'))).toBeUndefined();
  });
});

describe('useTailorResume', () => {
  it.each(['AI_NOT_CONFIGURED', 'PROFILE_INCOMPLETE', 'RATE_LIMITED'] as const)(
    "n affiche aucun toast pour le code %s (deja affiche par TailoringStatus depuis l erreur de la mutation)",
    async (code) => {
      tailorResume.mockRejectedValue(new ApiError('Message serveur.', 503, code));
      const client = makeClient();

      const { result } = renderHook(() => useTailorResume(), { wrapper: wrapperFor(client) });
      act(() => result.current.mutate({ jobId: 'job-1', template: 'CLASSIC' }));

      await waitFor(() => expect(result.current.isError).toBe(true));
      expect(result.current.error).toBeInstanceOf(ApiError);
      expect(toastError).not.toHaveBeenCalled();
    },
  );

  it('affiche un toast pour une erreur transitoire (code absent ou different)', async () => {
    tailorResume.mockRejectedValue(new ApiError('Le service ne repond pas.', 503, 'AI_UNAVAILABLE'));
    const client = makeClient();

    const { result } = renderHook(() => useTailorResume(), { wrapper: wrapperFor(client) });
    act(() => result.current.mutate({ jobId: 'job-1', template: 'CLASSIC' }));

    await waitFor(() => expect(result.current.isError).toBe(true));
    expect(toastError).toHaveBeenCalledWith('Le service ne repond pas.');
  });

  it('place la version creee en cache au succes', async () => {
    const created = makeResumeDto();
    tailorResume.mockResolvedValue(created);
    const client = makeClient();

    const { result } = renderHook(() => useTailorResume(), { wrapper: wrapperFor(client) });
    act(() => result.current.mutate({ jobId: 'job-1', template: 'CLASSIC' }));

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(client.getQueryData(resumeKeys.detail(created.id))).toEqual(created);
  });
});

describe('useCreateLetter', () => {
  it.each(['AI_NOT_CONFIGURED', 'PROFILE_INCOMPLETE', 'RATE_LIMITED'] as const)(
    'n affiche aucun toast pour le code %s',
    async (code) => {
      createLetter.mockRejectedValue(new ApiError('Message serveur.', 503, code));
      const client = makeClient();

      const { result } = renderHook(() => useCreateLetter(), { wrapper: wrapperFor(client) });
      act(() => result.current.mutate({ jobId: 'job-1', tone: 'PROFESSIONAL' }));

      await waitFor(() => expect(result.current.isError).toBe(true));
      expect(result.current.error).toBeInstanceOf(ApiError);
      expect(toastError).not.toHaveBeenCalled();
    },
  );

  it('affiche un toast pour une erreur transitoire', async () => {
    createLetter.mockRejectedValue(new ApiError('Le service ne repond pas.', 503, 'AI_UNAVAILABLE'));
    const client = makeClient();

    const { result } = renderHook(() => useCreateLetter(), { wrapper: wrapperFor(client) });
    act(() => result.current.mutate({ jobId: 'job-1', tone: 'PROFESSIONAL' }));

    await waitFor(() => expect(result.current.isError).toBe(true));
    expect(toastError).toHaveBeenCalledWith('Le service ne repond pas.');
  });
});
