import type { ApplicationBoardDto, ApplicationDetailDto, ApplicationDto, ApplicationListResponseDto } from '@jobtrack/shared';
import { createFromJobSchema } from '@jobtrack/shared';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, renderHook, waitFor } from '@testing-library/react';
import type { ReactNode } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { jobKeys } from '@/features/jobs/lib/query-keys';
import { ApiError } from '@/services/api/client';
import { applicationKeys } from '../lib/query-keys';
import {
  useApplication,
  useApplications,
  useApplicationsBoard,
  useApplicationStats,
  useCreateApplication,
  useDeleteApplication,
  useMoveApplication,
  useUpdateApplication,
} from './use-applications';

const fetchApplications = vi.hoisted(() => vi.fn());
const fetchApplicationStats = vi.hoisted(() => vi.fn());
const fetchApplicationBoard = vi.hoisted(() => vi.fn());
const fetchApplication = vi.hoisted(() => vi.fn());
const createApplication = vi.hoisted(() => vi.fn());
const updateApplication = vi.hoisted(() => vi.fn());
const moveApplication = vi.hoisted(() => vi.fn());
const deleteApplication = vi.hoisted(() => vi.fn());
const toastError = vi.hoisted(() => vi.fn());
const toastSuccess = vi.hoisted(() => vi.fn());

vi.mock('@/services/api/applications', () => ({
  fetchApplications,
  fetchApplicationStats,
  fetchApplicationBoard,
  fetchApplication,
  createApplication,
  updateApplication,
  moveApplication,
  deleteApplication,
}));

vi.mock('sonner', () => ({ toast: { error: toastError, success: toastSuccess } }));

afterEach(() => {
  fetchApplications.mockReset();
  fetchApplicationStats.mockReset();
  fetchApplicationBoard.mockReset();
  fetchApplication.mockReset();
  createApplication.mockReset();
  updateApplication.mockReset();
  moveApplication.mockReset();
  deleteApplication.mockReset();
  toastError.mockReset();
  toastSuccess.mockReset();
});

function makeClient(): QueryClient {
  return new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
}

function wrapperFor(client: QueryClient) {
  return ({ children }: { children: ReactNode }) => <QueryClientProvider client={client}>{children}</QueryClientProvider>;
}

function makeApplication(overrides: Partial<ApplicationDto> = {}): ApplicationDto {
  return {
    id: 'app-1',
    jobId: 'job-1',
    status: 'TO_APPLY',
    position: 0,
    jobTitle: 'Développeuse React',
    company: 'Piloto Software',
    locationLabel: null,
    salaryLabel: null,
    contractLabel: null,
    source: 'FRANCE_TRAVAIL',
    sourceUrl: null,
    appliedAt: null,
    usedBaseResume: false,
    resumeId: null,
    coverLetterId: null,
    notes: null,
    createdAt: '2026-09-17T00:00:00.000Z',
    updatedAt: '2026-09-17T00:00:00.000Z',
    job: null,
    resume: null,
    coverLetter: null,
    ...overrides,
  };
}

function makeApplicationDetail(overrides: Partial<ApplicationDetailDto> = {}): ApplicationDetailDto {
  return { ...makeApplication(), events: [], ...overrides };
}

function makeListResponse(items: ApplicationDto[]): ApplicationListResponseDto {
  return { items, page: 1, limit: 20, total: items.length };
}

function makeBoard(columns: Partial<Record<ApplicationDto['status'], ApplicationDto[]>> = {}): ApplicationBoardDto {
  return {
    columns: {
      TO_APPLY: [],
      APPLIED: [],
      INTERVIEW: [],
      OFFER: [],
      REJECTED: [],
      ...columns,
    },
  };
}

describe('useApplications', () => {
  it('renvoie la page de liste demandee', async () => {
    const response = makeListResponse([makeApplication()]);
    fetchApplications.mockResolvedValue(response);
    const client = makeClient();
    const query = { tab: 'all' as const };

    const { result } = renderHook(() => useApplications(query), { wrapper: wrapperFor(client) });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.data).toEqual(response);
    expect(fetchApplications).toHaveBeenCalledWith(query);
  });
});

describe('useApplicationStats', () => {
  it('renvoie les statistiques', async () => {
    const stats = { total: 3, byStatus: {}, appliedThisWeek: 1, interviewRate: null };
    fetchApplicationStats.mockResolvedValue(stats);
    const client = makeClient();

    const { result } = renderHook(() => useApplicationStats(), { wrapper: wrapperFor(client) });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.data).toEqual(stats);
  });
});

describe('useApplicationsBoard', () => {
  it('renvoie les colonnes du board', async () => {
    const board = makeBoard({ TO_APPLY: [makeApplication()] });
    fetchApplicationBoard.mockResolvedValue(board);
    const client = makeClient();

    const { result } = renderHook(() => useApplicationsBoard(), { wrapper: wrapperFor(client) });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.data).toEqual(board);
  });
});

describe('useApplication', () => {
  it('ne declenche aucun appel quand l identifiant est indefini', () => {
    const client = makeClient();
    renderHook(() => useApplication(undefined), { wrapper: wrapperFor(client) });
    expect(fetchApplication).not.toHaveBeenCalled();
  });

  it('renvoie le detail quand un identifiant est fourni', async () => {
    const detail = makeApplicationDetail();
    fetchApplication.mockResolvedValue(detail);
    const client = makeClient();

    const { result } = renderHook(() => useApplication('app-1'), { wrapper: wrapperFor(client) });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.data).toEqual(detail);
  });
});

describe('useCreateApplication', () => {
  it('place la candidature creee en cache et invalide listes/stats/board', async () => {
    const created = makeApplicationDetail();
    createApplication.mockResolvedValue(created);
    const client = makeClient();
    client.setQueryData(applicationKeys.stats, { total: 0, byStatus: {}, appliedThisWeek: 0, interviewRate: null });

    const { result } = renderHook(() => useCreateApplication(), { wrapper: wrapperFor(client) });
    act(() => result.current.mutate(createFromJobSchema.parse({ jobId: 'job-1' })));

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(client.getQueryData(applicationKeys.detail('app-1'))).toEqual(created);
    expect(client.getQueryState(applicationKeys.stats)?.isInvalidated).toBe(true);
  });

  it('invalide le detail de l offre quand la creation part d une offre suivie', async () => {
    createApplication.mockResolvedValue(makeApplicationDetail());
    const client = makeClient();
    client.setQueryData(jobKeys.detail('job-1'), { id: 'job-1' });

    const { result } = renderHook(() => useCreateApplication(), { wrapper: wrapperFor(client) });
    act(() => result.current.mutate(createFromJobSchema.parse({ jobId: 'job-1' })));

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(client.getQueryState(jobKeys.detail('job-1'))?.isInvalidated).toBe(true);
  });

  it('n affiche aucun toast pour le code APPLICATION_EXISTS (la page ouvre la fiche existante)', async () => {
    createApplication.mockRejectedValue(new ApiError('Une candidature existe déjà.', 409, 'APPLICATION_EXISTS', { applicationId: 'app-1' }));
    const client = makeClient();

    const { result } = renderHook(() => useCreateApplication(), { wrapper: wrapperFor(client) });
    act(() => result.current.mutate(createFromJobSchema.parse({ jobId: 'job-1' })));

    await waitFor(() => expect(result.current.isError).toBe(true));
    expect(toastError).not.toHaveBeenCalled();
  });

  it('affiche un toast pour toute autre erreur', async () => {
    createApplication.mockRejectedValue(new ApiError('Offre introuvable.', 404, 'JOB_NOT_FOUND'));
    const client = makeClient();

    const { result } = renderHook(() => useCreateApplication(), { wrapper: wrapperFor(client) });
    act(() => result.current.mutate(createFromJobSchema.parse({ jobId: 'job-1' })));

    await waitFor(() => expect(result.current.isError).toBe(true));
    expect(toastError).toHaveBeenCalledWith('Offre introuvable.');
  });
});

describe('useUpdateApplication', () => {
  it('met a jour le detail et les listes en cache de facon optimiste', async () => {
    updateApplication.mockImplementation(() => new Promise((resolve) => setTimeout(resolve, 20)));
    const client = makeClient();
    client.setQueryData(applicationKeys.detail('app-1'), makeApplicationDetail({ status: 'TO_APPLY' }));
    const query = { tab: 'all' as const };
    client.setQueryData(applicationKeys.list(query), makeListResponse([makeApplication({ id: 'app-1', status: 'TO_APPLY' })]));

    const { result } = renderHook(() => useUpdateApplication(), { wrapper: wrapperFor(client) });
    act(() => result.current.mutate({ id: 'app-1', input: { status: 'INTERVIEW' } }));

    await waitFor(() => {
      expect(client.getQueryData<ApplicationDetailDto>(applicationKeys.detail('app-1'))?.status).toBe('INTERVIEW');
    });
    const list = client.getQueryData<ApplicationListResponseDto>(applicationKeys.list(query));
    expect(list?.items[0]?.status).toBe('INTERVIEW');
  });

  it('restaure le detail et les listes puis affiche un toast quand la modification echoue', async () => {
    updateApplication.mockRejectedValue(new ApiError('Statut invalide.', 400));
    const client = makeClient();
    client.setQueryData(applicationKeys.detail('app-1'), makeApplicationDetail({ status: 'TO_APPLY' }));
    const query = { tab: 'all' as const };
    client.setQueryData(applicationKeys.list(query), makeListResponse([makeApplication({ id: 'app-1', status: 'TO_APPLY' })]));

    const { result } = renderHook(() => useUpdateApplication(), { wrapper: wrapperFor(client) });
    act(() => result.current.mutate({ id: 'app-1', input: { status: 'INTERVIEW' } }));

    await waitFor(() => expect(result.current.isError).toBe(true));
    expect(client.getQueryData<ApplicationDetailDto>(applicationKeys.detail('app-1'))?.status).toBe('TO_APPLY');
    const list = client.getQueryData<ApplicationListResponseDto>(applicationKeys.list(query));
    expect(list?.items[0]?.status).toBe('TO_APPLY');
    expect(toastError).toHaveBeenCalledWith('Statut invalide.');
  });
});

describe('useMoveApplication', () => {
  it('deplace la carte et reindexe les deux colonnes de facon optimiste', async () => {
    moveApplication.mockImplementation(() => new Promise((resolve) => setTimeout(resolve, 20)));
    const client = makeClient();
    const moving = makeApplication({ id: 'app-1', status: 'TO_APPLY', position: 0 });
    const staying = makeApplication({ id: 'app-2', status: 'TO_APPLY', position: 1 });
    const targetCard = makeApplication({ id: 'app-3', status: 'APPLIED', position: 0 });
    client.setQueryData(applicationKeys.board, makeBoard({ TO_APPLY: [moving, staying], APPLIED: [targetCard] }));

    const { result } = renderHook(() => useMoveApplication(), { wrapper: wrapperFor(client) });
    act(() => result.current.mutate({ id: 'app-1', input: { status: 'APPLIED', position: 0 } }));

    await waitFor(() => {
      const board = client.getQueryData<ApplicationBoardDto>(applicationKeys.board);
      expect(board?.columns.APPLIED.map((item) => item.id)).toEqual(['app-1', 'app-3']);
    });
    const board = client.getQueryData<ApplicationBoardDto>(applicationKeys.board);
    expect(board?.columns.TO_APPLY.map((item) => ({ id: item.id, position: item.position }))).toEqual([{ id: 'app-2', position: 0 }]);
    expect(board?.columns.APPLIED.map((item) => ({ id: item.id, position: item.position }))).toEqual([
      { id: 'app-1', position: 0 },
      { id: 'app-3', position: 1 },
    ]);
    expect(board?.columns.APPLIED.find((item) => item.id === 'app-1')?.status).toBe('APPLIED');
  });

  it('restaure le board et affiche un toast quand le deplacement echoue', async () => {
    moveApplication.mockRejectedValue(new ApiError('Deplacement refuse.', 404));
    const client = makeClient();
    const moving = makeApplication({ id: 'app-1', status: 'TO_APPLY', position: 0 });
    const original = makeBoard({ TO_APPLY: [moving] });
    client.setQueryData(applicationKeys.board, original);

    const { result } = renderHook(() => useMoveApplication(), { wrapper: wrapperFor(client) });
    act(() => result.current.mutate({ id: 'app-1', input: { status: 'APPLIED', position: 0 } }));

    await waitFor(() => expect(result.current.isError).toBe(true));
    expect(client.getQueryData<ApplicationBoardDto>(applicationKeys.board)).toEqual(original);
    expect(toastError).toHaveBeenCalledWith('Deplacement refuse.');
  });
});

describe('useDeleteApplication', () => {
  it('purge le detail en cache et affiche un toast de succes', async () => {
    deleteApplication.mockResolvedValue(undefined);
    const client = makeClient();
    client.setQueryData(applicationKeys.detail('app-1'), makeApplicationDetail());

    const { result } = renderHook(() => useDeleteApplication(), { wrapper: wrapperFor(client) });
    act(() => result.current.mutate({ id: 'app-1' }));

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(client.getQueryData(applicationKeys.detail('app-1'))).toBeUndefined();
    expect(toastSuccess).toHaveBeenCalledWith('Candidature supprimée.');
  });

  it('invalide le detail de l offre quand elle est connue', async () => {
    deleteApplication.mockResolvedValue(undefined);
    const client = makeClient();
    client.setQueryData(jobKeys.detail('job-1'), { id: 'job-1' });

    const { result } = renderHook(() => useDeleteApplication(), { wrapper: wrapperFor(client) });
    act(() => result.current.mutate({ id: 'app-1', jobId: 'job-1' }));

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(client.getQueryState(jobKeys.detail('job-1'))?.isInvalidated).toBe(true);
  });
});
