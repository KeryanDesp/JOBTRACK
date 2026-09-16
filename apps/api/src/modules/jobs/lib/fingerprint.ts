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

/**
 * Formes juridiques à retirer en fin de raison sociale (« ACME S.A.S. »,
 * « Acme SAS », « Acme » doivent produire la même clé) : jamais au milieu du
 * nom, seulement en dernier mot, pour ne pas tronquer un nom d'entreprise qui
 * les contiendrait légitimement ailleurs.
 */
const LEGAL_FORM_SUFFIXES = new Set(['sas', 'sasu', 'sarl', 'sa', 'eurl', 'sci', 'snc', 'scop']);

/**
 * Recolle les lettres isolées (« s », « a », « s » → « sas », issues de
 * « S.A.S. » une fois la ponctuation transformée en espaces par
 * `normalizeForKey`) en un seul mot, pour ne pas les confondre avec des
 * initiales ou des mots distincts.
 */
function glueIsolatedLetters(words: string[]): string[] {
  const glued: string[] = [];
  let buffer = '';
  for (const word of words) {
    if (word.length === 1) {
      buffer += word;
      continue;
    }
    if (buffer) {
      glued.push(buffer);
      buffer = '';
    }
    glued.push(word);
  }
  if (buffer) glued.push(buffer);
  return glued;
}

/**
 * Normalisation d'une raison sociale pour la clé d'empreinte uniquement
 * (jamais pour l'affichage) : `normalizeForKey`, puis lettres isolées
 * recollées et forme juridique finale retirée — « ACME S.A.S. », « Acme
 * SAS » et « Acme » donnent la même clé.
 */
export function normalizeCompany(company: string): string {
  const base = normalizeForKey(company);
  if (!base) return base;
  const words = glueIsolatedLetters(base.split(' '));
  const last = words.at(-1);
  if (words.length > 1 && last && LEGAL_FORM_SUFFIXES.has(last)) words.pop();
  return words.join(' ');
}

export function jobFingerprint(input: FingerprintInput): string {
  const normCompany = normalizeCompany(input.company ?? '');
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
