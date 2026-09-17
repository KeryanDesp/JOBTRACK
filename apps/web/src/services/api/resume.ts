import type {
  BaseResumeDto,
  CoverLetterDto,
  CoverLetterSummaryDto,
  CreateCoverLetterInput,
  CreateTailoredResumeInput,
  ResumeDto,
  ResumeSummaryDto,
  UpdateCoverLetterInput,
  UpdateResumeInput,
  UpdateResumeTemplateInput,
} from '@jobtrack/shared';
import { apiRequest } from './client';

// Routes spec §6. Le PDF n'est jamais une route : il est produit côté client
// (`features/resume/components/download-pdf-button.tsx`).

export const fetchBaseResume = () => apiRequest<BaseResumeDto>('/resume/base');

export function updateResumeTemplate(input: UpdateResumeTemplateInput): Promise<BaseResumeDto> {
  return apiRequest<BaseResumeDto>('/resume/template', {
    method: 'PATCH',
    body: JSON.stringify(input),
  });
}

export const fetchResumes = () => apiRequest<ResumeSummaryDto[]>('/resume');

export function tailorResume(input: CreateTailoredResumeInput): Promise<ResumeDto> {
  return apiRequest<ResumeDto>('/resume/tailor', {
    method: 'POST',
    body: JSON.stringify(input),
  });
}

export const fetchResume = (id: string) => apiRequest<ResumeDto>(`/resume/${id}`);

export function updateResume(id: string, input: UpdateResumeInput): Promise<ResumeDto> {
  return apiRequest<ResumeDto>(`/resume/${id}`, {
    method: 'PATCH',
    body: JSON.stringify(input),
  });
}

// 204 sans corps : `apiRequest` renvoie `undefined` pour ce statut.
export const deleteResume = (id: string) => apiRequest<void>(`/resume/${id}`, { method: 'DELETE' });

export const fetchLetters = () => apiRequest<CoverLetterSummaryDto[]>('/resume/letters');

export function createLetter(input: CreateCoverLetterInput): Promise<CoverLetterDto> {
  return apiRequest<CoverLetterDto>('/resume/letters', {
    method: 'POST',
    body: JSON.stringify(input),
  });
}

export const fetchLetter = (id: string) => apiRequest<CoverLetterDto>(`/resume/letters/${id}`);

export function updateLetter(id: string, input: UpdateCoverLetterInput): Promise<CoverLetterDto> {
  return apiRequest<CoverLetterDto>(`/resume/letters/${id}`, {
    method: 'PATCH',
    body: JSON.stringify(input),
  });
}

export const deleteLetter = (id: string) => apiRequest<void>(`/resume/letters/${id}`, { method: 'DELETE' });
