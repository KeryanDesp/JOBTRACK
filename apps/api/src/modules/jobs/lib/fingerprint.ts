import { createHash } from 'node:crypto';
import type { JobSourceKind } from '@prisma/client';
import { normalizeForKey } from './text';
import type { JobDraft } from './job-draft';

/**
 * Empreinte de déduplication (spec §5) :
 * `sha256(norm(company)|norm(title)|communeCode ?? norm(locationLabel))`.
 * Sans entreprise (après normalisation), l'empreinte inclut la source et son
 * identifiant externe pour ne jamais fusionner deux offres à l'aveugle. La
 * description et l'URL varient d'une republication à l'autre : exclues par
 * choix (décision tracée dans la spec).
 */
export interface FingerprintInput {
  company: string | null;
  title: string;
  communeCode: string | null;
  locationLabel: string | null;
  sourceKind: JobSourceKind;
  externalId: string;
}

export function jobFingerprint(input: FingerprintInput): string {
  const normCompany = normalizeForKey(input.company ?? '');
  const normTitle = normalizeForKey(input.title);
  const locationKey = input.communeCode ?? normalizeForKey(input.locationLabel ?? '');

  const base = normCompany
    ? `${normCompany}|${normTitle}|${locationKey}`
    : `${normTitle}|${locationKey}|${input.sourceKind}:${input.externalId}`;

  return createHash('sha256').update(base).digest('hex');
}

/** Calcule l'empreinte d'un `JobDraft` déjà normalisé (raccourci pour l'ingestion et les tests). */
export function draftFingerprint(draft: JobDraft): string {
  return jobFingerprint({
    company: draft.company,
    title: draft.title,
    communeCode: draft.communeCode,
    locationLabel: draft.locationLabel,
    sourceKind: draft.source.kind,
    externalId: draft.source.externalId,
  });
}
