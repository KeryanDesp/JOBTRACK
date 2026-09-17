import type { ApplicationBoardDto, ApplicationDetailDto, ApplicationDto, ApplicationListResponseDto } from '@jobtrack/shared';
import { createFromJobSchema, updateApplicationSchema } from '@jobtrack/shared';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, renderHook, waitFor } from '@testing-library/react';
import type { ReactNode } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { jobKeys } from '@/features/jobs/lib/query-keys';
import { ApiError } from '@/services/api/client';
import { applicationKeys } from '../lib/query-keys';
import {
  moveCardInBoard,
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

  it('ne declenche aucun appel quand l identifiant est une chaine vide', () => {
    const client = makeClient();
    renderHook(() => useApplication(''), { wrapper: wrapperFor(client) });
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

  it('ne fusionne pas les cles explicitement indefinies du schema partage', async () => {
    updateApplication.mockImplementation(() => new Promise((resolve) => setTimeout(resolve, 20)));
    const client = makeClient();
    client.setQueryData(applicationKeys.detail('app-1'), makeApplicationDetail({ status: 'TO_APPLY', notes: 'Note existante' }));
    // `updateApplicationSchema.parse` (comme cote serveur) pose toutes les cles du shape sur sa
    // sortie, `undefined` pour celles absentes de l entree — reproduit ici le cas reel qu un
    // litteral partiel `{ status: 'INTERVIEW' }` ecrit a la main ne couvre pas.
    const input = updateApplicationSchema.parse({ status: 'INTERVIEW' });

    const { result } = renderHook(() => useUpdateApplication(), { wrapper: wrapperFor(client) });
    act(() => result.current.mutate({ id: 'app-1', input }));

    await waitFor(() => {
      expect(client.getQueryData<ApplicationDetailDto>(applicationKeys.detail('app-1'))?.status).toBe('INTERVIEW');
    });
    expect(client.getQueryData<ApplicationDetailDto>(applicationKeys.detail('app-1'))?.notes).toBe('Note existante');
  });
});

describe('moveCardInBoard', () => {
  it('reordonne vers le bas dans la meme colonne', () => {
    const a = makeApplication({ id: 'app-1', status: 'TO_APPLY', position: 0 });
    const b = makeApplication({ id: 'app-2', status: 'TO_APPLY', position: 1 });
    const c = makeApplication({ id: 'app-3', status: 'TO_APPLY', position: 2 });
    const board = makeBoard({ TO_APPLY: [a, b, c] });

    const result = moveCardInBoard(board, 'app-1', { status: 'TO_APPLY', position: 2 });

    expect(result.columns.TO_APPLY.map((item) => item.id)).toEqual(['app-2', 'app-3', 'app-1']);
    expect(result.columns.TO_APPLY.map((item) => item.position)).toEqual([0, 1, 2]);
  });

  it('reordonne vers le haut dans la meme colonne', () => {
    const a = makeApplication({ id: 'app-1', status: 'TO_APPLY', position: 0 });
    const b = makeApplication({ id: 'app-2', status: 'TO_APPLY', position: 1 });
    const c = makeApplication({ id: 'app-3', status: 'TO_APPLY', position: 2 });
    const board = makeBoard({ TO_APPLY: [a, b, c] });

    const result = moveCardInBoard(board, 'app-3', { status: 'TO_APPLY', position: 0 });

    expect(result.columns.TO_APPLY.map((item) => item.id)).toEqual(['app-3', 'app-1', 'app-2']);
    expect(result.columns.TO_APPLY.map((item) => item.position)).toEqual([0, 1, 2]);
  });

  it('borne la position demandee au-dela de la longueur de la colonne', () => {
    const a = makeApplication({ id: 'app-1', status: 'TO_APPLY', position: 0 });
    const b = makeApplication({ id: 'app-2', status: 'TO_APPLY', position: 1 });
    const board = makeBoard({ TO_APPLY: [a, b] });

    const result = moveCardInBoard(board, 'app-1', { status: 'TO_APPLY', position: 999 });

    expect(result.columns.TO_APPLY.map((item) => item.id)).toEqual(['app-2', 'app-1']);
  });

  it('renvoie la meme reference quand la carte est introuvable', () => {
    const board = makeBoard({ TO_APPLY: [makeApplication({ id: 'app-1' })] });

    const result = moveCardInBoard(board, 'inconnu', { status: 'APPLIED', position: 0 });

    expect(result).toBe(board);
  });

  it('reindexe les deux colonnes lors d un deplacement inter-colonnes', () => {
    const moving = makeApplication({ id: 'app-1', status: 'TO_APPLY', position: 0 });
    const staying = makeApplication({ id: 'app-2', status: 'TO_APPLY', position: 1 });
    const target = makeApplication({ id: 'app-3', status: 'APPLIED', position: 0 });
    const board = makeBoard({ TO_APPLY: [moving, staying], APPLIED: [target] });

    const result = moveCardInBoard(board, 'app-1', { status: 'APPLIED', position: 0 });

    expect(result.columns.TO_APPLY.map((item) => ({ id: item.id, position: item.position }))).toEqual([
      { id: 'app-2', position: 0 },
    ]);
    expect(result.columns.APPLIED.map((item) => ({ id: item.id, position: item.position, status: item.status }))).toEqual([
      { id: 'app-1', position: 0, status: 'APPLIED' },
      { id: 'app-3', position: 1, status: 'APPLIED' },
    ]);
  });

  it('ne mute pas le board source', () => {
    const moving = makeApplication({ id: 'app-1', status: 'TO_APPLY', position: 0 });
    const staying = makeApplication({ id: 'app-2', status: 'TO_APPLY', position: 1 });
    const target = makeApplication({ id: 'app-3', status: 'APPLIED', position: 0 });
    const board = makeBoard({ TO_APPLY: [moving, staying], APPLIED: [target] });
    const originalToApply = board.columns.TO_APPLY;
    const originalApplied = board.columns.APPLIED;

    moveCardInBoard(board, 'app-1', { status: 'APPLIED', position: 0 });

    expect(board.columns.TO_APPLY).toBe(originalToApply);
    expect(board.columns.APPLIED).toBe(originalApplied);
    expect(board.columns.TO_APPLY.map((item) => item.id)).toEqual(['app-1', 'app-2']);
    expect(board.columns.APPLIED.map((item) => item.id)).toEqual(['app-3']);
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

  it('restaure exactement les deux colonnes quand le deplacement inter-colonnes echoue', async () => {
    moveApplication.mockRejectedValue(new ApiError('Deplacement refuse.', 404));
    const client = makeClient();
    const moving = makeApplication({ id: 'app-1', status: 'TO_APPLY', position: 0 });
    const staying = makeApplication({ id: 'app-2', status: 'TO_APPLY', position: 1 });
    const target = makeApplication({ id: 'app-3', status: 'APPLIED', position: 0 });
    const original = makeBoard({ TO_APPLY: [moving, staying], APPLIED: [target] });
    client.setQueryData(applicationKeys.board, original);

    const { result } = renderHook(() => useMoveApplication(), { wrapper: wrapperFor(client) });
    act(() => result.current.mutate({ id: 'app-1', input: { status: 'APPLIED', position: 0 } }));

    await waitFor(() => expect(result.current.isError).toBe(true));
    expect(client.getQueryData<ApplicationBoardDto>(applicationKeys.board)).toEqual(original);
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
