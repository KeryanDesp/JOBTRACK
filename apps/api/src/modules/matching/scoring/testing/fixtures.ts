import type { JobRequirements } from '@jobtrack/shared';
import type { JobInputs, ProfileInputs } from '../types';

/** Horodatage fixe utilisé par les tests du moteur de score (déterminisme). */
export const NOW = new Date('2026-09-17T00:00:00.000Z');

/** `ProfileInputs` par défaut (profil totalement vide) — chaque test ne fournit que les champs qui l'intéressent. */
export function baseProfile(overrides: Partial<ProfileInputs> = {}): ProfileInputs {
  return {
    skills: [],
    projectTechnologies: [],
    experienceYears: null,
    experiences: [],
    educationLevel: null,
    languages: [],
    preferredCommuneCodes: [],
    preferredDepartmentCodes: [],
    salaryMin: null,
    salaryMax: null,
    contractTypes: [],
    remoteModes: [],
    experienceLevel: null,
    complete: false,
    ...overrides,
  };
}

/** `JobInputs` par défaut (offre sans aucune information structurée). */
export function baseJob(overrides: Partial<JobInputs> = {}): JobInputs {
  return {
    communeCode: null,
    departmentCode: null,
    contractType: null,
    remoteMode: null,
    remoteModeInferred: false,
    experienceLevel: null,
    experienceRequired: null,
    salaryMinAnnual: null,
    salaryMaxAnnual: null,
    skills: [],
    languages: [],
    publishedAt: NOW,
    ...overrides,
  };
}

/** `JobRequirements` par défaut (analyse sans aucune exigence extraite). */
export function baseRequirements(overrides: Partial<JobRequirements> = {}): JobRequirements {
  return {
    technologies: [],
    softSkills: [],
    experienceYearsMin: null,
    seniority: null,
    educationLevel: null,
    educationFields: [],
    languages: [],
    remoteMode: null,
    contractHints: [],
    mustHaves: [],
    niceToHaves: [],
    summary: '',
    ...overrides,
  };
}
