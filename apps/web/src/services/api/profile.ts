import type {
  CertificationInput,
  EducationInput,
  ExperienceInput,
  JobPreferencesInput,
  LanguageInput,
  ProfileInput,
  ProjectInput,
  ReorderInput,
  SkillInput,
} from '@jobtrack/shared';
import { apiRequest } from './client';

export interface ProfileDto {
  id: string;
  firstName: string;
  lastName: string;
  phone: string | null;
  city: string | null;
  country: string | null;
  title: string | null;
  summary: string | null;
  yearsExperience: number | null;
  avatarUrl: string | null;
}

// Dérivés des unions du schéma de saisie plutôt que redéclarés : une évolution
// du contrat (ajout d'un mode de travail, etc.) reste alors synchronisée sans y penser.
export type RemoteMode = JobPreferencesInput['remoteModes'][number];
export type ContractType = JobPreferencesInput['contractTypes'][number];
export type ExperienceLevel = NonNullable<JobPreferencesInput['experienceLevel']>;

export interface PreferencesDto {
  id: string;
  desiredRoles: string[];
  desiredCategories: string[];
  salaryMin: number | null;
  salaryMax: number | null;
  currency: string;
  locations: string[];
  searchRadiusKm: number;
  remoteModes: RemoteMode[];
  contractTypes: ContractType[];
  availability: string | null;
  experienceLevel: ExperienceLevel | null;
}

export const fetchProfile = () => apiRequest<ProfileDto>('/profile');

export const updateProfile = (body: ProfileInput) =>
  apiRequest<ProfileDto>('/profile', { method: 'PATCH', body: JSON.stringify(body) });

export const fetchPreferences = () => apiRequest<PreferencesDto>('/profile/preferences');

export const updatePreferences = (body: JobPreferencesInput) =>
  apiRequest<PreferencesDto>('/profile/preferences', { method: 'PATCH', body: JSON.stringify(body) });

export const COLLECTIONS = [
  'experiences',
  'educations',
  'skills',
  'languages',
  'certifications',
  'projects',
] as const;

export type CollectionName = (typeof COLLECTIONS)[number];

export interface CollectionInputs {
  experiences: ExperienceInput;
  educations: EducationInput;
  skills: SkillInput;
  languages: LanguageInput;
  certifications: CertificationInput;
  projects: ProjectInput;
}

export type CollectionItem<N extends CollectionName> = CollectionInputs[N] & {
  id: string;
  sortOrder: number;
};

export const fetchCollection = <N extends CollectionName>(name: N) =>
  apiRequest<CollectionItem<N>[]>(`/profile/${name}`);

export const createItem = <N extends CollectionName>(name: N, body: CollectionInputs[N]) =>
  apiRequest<CollectionItem<N>>(`/profile/${name}`, { method: 'POST', body: JSON.stringify(body) });

export const updateItem = <N extends CollectionName>(name: N, id: string, body: CollectionInputs[N]) =>
  apiRequest<CollectionItem<N>>(`/profile/${name}/${id}`, { method: 'PATCH', body: JSON.stringify(body) });

export const deleteItem = (name: CollectionName, id: string) =>
  apiRequest<void>(`/profile/${name}/${id}`, { method: 'DELETE' });

export const reorderCollection = (name: CollectionName, body: ReorderInput) =>
  apiRequest<void>(`/profile/${name}/reorder`, { method: 'PATCH', body: JSON.stringify(body) });
