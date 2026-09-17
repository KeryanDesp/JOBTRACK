import type { ContractType, ExperienceLevel, JobRequirementKind, JobSourceKind, RemoteMode } from '@prisma/client';

/**
 * Offre canonique normalisée, avant persistance. Reprend les champs scalaires
 * de `Job` (schéma Prisma) à l'exception de ceux gérés par l'ingestion
 * (`id`, `fingerprint`, `firstSeenAt`, `lastSeenAt`, `createdAt`, `updatedAt`,
 * `expiredAt`), et ajoute les relations à créer (`skills`, `requirements`) et
 * la source d'origine (`source`, un `JobSource` pas encore persisté).
 */
export interface JobDraft {
  title: string;
  company: string | null;
  companyDescription: string | null;
  companyUrl: string | null;
  companyLogoUrl: string | null;
  description: string;
  locationLabel: string | null;
  communeCode: string | null;
  postalCode: string | null;
  departmentCode: string | null;
  latitude: number | null;
  longitude: number | null;
  contractType: ContractType | null;
  contractLabel: string | null;
  contractNature: string | null;
  remoteMode: RemoteMode | null;
  remoteModeInferred: boolean;
  experienceLevel: ExperienceLevel | null;
  experienceLabel: string | null;
  experienceRequired: boolean | null;
  salaryMinAnnual: number | null;
  salaryMaxAnnual: number | null;
  salaryLabel: string | null;
  currency: string;
  workingTimeLabel: string | null;
  isFullTime: boolean | null;
  isApprenticeship: boolean;
  positionsCount: number | null;
  accessibleTh: boolean | null;
  sectorLabel: string | null;
  romeCode: string | null;
  romeLabel: string | null;
  qualificationLabel: string | null;
  publishedAt: Date;
  sourceUpdatedAt: Date | null;
  skills: JobDraftSkill[];
  requirements: JobDraftRequirement[];
  source: JobDraftSource;
}

export interface JobDraftSkill {
  name: string;
  required: boolean;
}

export interface JobDraftRequirement {
  kind: JobRequirementKind;
  label: string;
  required: boolean;
}

export interface JobDraftSource {
  kind: JobSourceKind;
  externalId: string;
  url: string;
  applyUrl: string | null;
  partnerName: string | null;
  publishedAt: Date;
  sourceUpdatedAt: Date | null;
}
