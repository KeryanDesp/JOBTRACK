import type {
  CertificationFormInput,
  CertificationInput,
  EducationFormInput,
  EducationInput,
  ExperienceFormInput,
  ExperienceInput,
  JobPreferencesFormInput,
  JobPreferencesInput,
  LanguageFormInput,
  LanguageInput,
  ProfileFormInput,
  ProjectFormInput,
  ProjectInput,
  ReorderFormInput,
  SkillFormInput,
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

// `ProfileFormInput` (type d'entrée Zod) et non `ProfileInput` (sortie) : un champ
// texte effaçable accepte encore `''` côté formulaire, et `ProfileInput` l'a déjà
// normalisé en `null` — un appelant qui construirait ce corps depuis un formulaire
// ne pourrait jamais y écrire `''`.
export const updateProfile = (body: ProfileFormInput) =>
  apiRequest<ProfileDto>('/profile', { method: 'PATCH', body: JSON.stringify(body) });

export const fetchPreferences = () => apiRequest<PreferencesDto>('/profile/preferences');

export const updatePreferences = (body: JobPreferencesFormInput) =>
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

// Ce que le formulaire envoie (type d'entrée Zod : `.default()` optionnel,
// texte effaçable encore `''`) — utilisé pour typer les corps de requête.
export interface CollectionInputs {
  experiences: ExperienceFormInput;
  educations: EducationFormInput;
  skills: SkillFormInput;
  languages: LanguageFormInput;
  certifications: CertificationFormInput;
  projects: ProjectFormInput;
}

// Ce que l'API renvoie (type de sortie Zod : défauts posés, texte effacé déjà
// normalisé en `null`) — utilisé pour typer les items lus depuis le serveur.
export interface CollectionOutputs {
  experiences: ExperienceInput;
  educations: EducationInput;
  skills: SkillInput;
  languages: LanguageInput;
  certifications: CertificationInput;
  projects: ProjectInput;
}

export type CollectionItem<N extends CollectionName> = CollectionOutputs[N] & {
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

export const reorderCollection = (name: CollectionName, body: ReorderFormInput) =>
  apiRequest<void>(`/profile/${name}/reorder`, { method: 'PATCH', body: JSON.stringify(body) });
