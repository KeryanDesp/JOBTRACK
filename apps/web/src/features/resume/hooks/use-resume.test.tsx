import type { BaseResumeDto, ResumeSummaryDto } from '@jobtrack/shared';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, renderHook, waitFor } from '@testing-library/react';
import type { ReactNode } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ApiError } from '@/services/api/client';
import { resumeKeys } from '../lib/query-keys';
import { useDeleteResume, useResumeTemplate } from './use-resume';

const deleteResume = vi.hoisted(() => vi.fn());
const updateResumeTemplate = vi.hoisted(() => vi.fn());
const toastError = vi.hoisted(() => vi.fn());

vi.mock('@/services/api/resume', () => ({
  fetchBaseResume: vi.fn(),
  updateResumeTemplate,
  fetchResumes: vi.fn(),
  fetchResume: vi.fn(),
  tailorResume: vi.fn(),
  updateResume: vi.fn(),
  deleteResume,
  fetchLetters: vi.fn(),
  fetchLetter: vi.fn(),
  createLetter: vi.fn(),
  updateLetter: vi.fn(),
  deleteLetter: vi.fn(),
}));

vi.mock('sonner', () => ({ toast: { error: toastError, success: vi.fn() } }));

afterEach(() => {
  deleteResume.mockReset();
  updateResumeTemplate.mockReset();
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

function makeBaseResume(overrides: Partial<BaseResumeDto> = {}): BaseResumeDto {
  return {
    content: {
      schemaVersion: 1,
      identity: { firstName: 'Alice', lastName: 'Martin', title: null },
      summary: '',
      experiences: [],
      educations: [],
      skills: [],
      languages: [],
      certifications: [],
      projects: [],
    },
    template: 'CLASSIC',
    profileComplete: true,
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
