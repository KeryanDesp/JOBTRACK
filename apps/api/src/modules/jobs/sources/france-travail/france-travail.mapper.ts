import type { ContractType } from '@prisma/client';
import { cleanLocationLabel, cleanText, normalizeForKey } from '../../lib/text';
import { parseSalaryLabel } from '../../lib/salary';
import { detectRemoteMode } from '../../lib/remote';
import { mapExperience } from '../../lib/experience';
import type { JobDraft, JobDraftRequirement, JobDraftSkill } from '../../lib/job-draft';
import type { FranceTravailOffer } from './france-travail.schemas';

/**
 * Mapper pur France Travail → `JobDraft` (spec §5). Aucun accès réseau ni base
 * ici : une offre déjà validée par `franceTravailOfferSchema` entre, un
 * brouillon d'offre canonique (ou `null` si l'offre est inexploitable) sort.
 */

const MAX_DESCRIPTION_LENGTH = 20_000;
const MAX_COMPANY_NAME_LENGTH = 200;
const MAX_COMPANY_DESCRIPTION_LENGTH = 5_000;
const MAX_SALARY_LABEL_LENGTH = 200;
const FALLBACK_OFFER_URL = 'https://candidat.francetravail.fr/offres/recherche/detail/';

/** `typeContrat` → `ContractType` (spec §5). Un code inconnu ne fait jamais deviner un contrat. */
const CONTRACT_TYPE_BY_CODE: Record<string, ContractType> = {
  CDI: 'CDI',
  CDD: 'CDD',
  MIS: 'INTERIM',
  SAI: 'CDD',
  LIB: 'FREELANCE',
  FRA: 'FREELANCE',
  CCE: 'FREELANCE',
  REP: 'FREELANCE',
};

/** `natureContrat` signalant un apprentissage ou une professionnalisation. */
const APPRENTICESHIP_NATURE_CODES = new Set(['E2', 'FS']);

function isHttpUrl(value: string | null | undefined): value is string {
  return typeof value === 'string' && /^https?:\/\//i.test(value);
}

/** Parse une date ISO France Travail ; renvoie `null` si absente ou invalide (jamais une exception). */
function parseDateOrNull(value: string | null | undefined): Date | null {
  if (!value) return null;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

/**
 * Code département depuis un code commune INSEE : les deux premiers
 * caractères en général — ce qui donne directement `2A`/`2B` pour la Corse,
 * déjà sur deux caractères — sauf les DOM (`97x`/`98x`), dont les trois
 * premiers caractères du code commune forment le département.
 */
function departmentCodeFromCommuneCode(communeCode: string): string {
  const upper = communeCode.toUpperCase();
  if (upper.startsWith('97') || upper.startsWith('98')) return upper.slice(0, 3);
  return upper.slice(0, 2);
}

/** Repli sur le code postal quand `commune` est absent (mêmes règles DOM). */
function departmentCodeFromPostalCode(postalCode: string): string {
  if (postalCode.startsWith('97') || postalCode.startsWith('98')) return postalCode.slice(0, 3);
  return postalCode.slice(0, 2);
}

function mapSkills(offer: FranceTravailOffer): JobDraftSkill[] {
  const seen = new Set<string>();
  const skills: JobDraftSkill[] = [];
  for (const competence of offer.competences) {
    const name = competence.libelle?.trim();
    if (!name) continue;
    const key = normalizeForKey(name);
    if (!key || seen.has(key)) continue;
    seen.add(key);
    skills.push({ name, required: competence.exigence === 'E' });
  }
  return skills;
}

function mapRequirements(offer: FranceTravailOffer): JobDraftRequirement[] {
  const requirements: JobDraftRequirement[] = [];

  for (const formation of offer.formations) {
    const label = [formation.niveauLibelle, formation.domaineLibelle].filter(Boolean).join(' – ');
    if (!label) continue;
    requirements.push({ kind: 'EDUCATION', label, required: formation.exigence === 'E' });
  }

  for (const langue of offer.langues) {
    const label = langue.libelle?.trim();
    if (!label) continue;
    requirements.push({ kind: 'LANGUAGE', label, required: langue.exigence === 'E' });
  }

  return requirements;
}

/** Contrat + nature (apprentissage) : l'apprentissage prévaut sur le code `typeContrat` sous-jacent. */
function mapContract(offer: FranceTravailOffer): { contractType: ContractType | null; isApprenticeship: boolean } {
  const isApprenticeship =
    (offer.natureContrat != null && APPRENTICESHIP_NATURE_CODES.has(offer.natureContrat)) ||
    offer.alternance === true;

  if (isApprenticeship) return { contractType: 'APPRENTICESHIP', isApprenticeship: true };

  const contractType = offer.typeContrat ? CONTRACT_TYPE_BY_CODE[offer.typeContrat] ?? null : null;
  return { contractType, isApprenticeship: false };
}

function mapLocation(offer: FranceTravailOffer): {
  communeCode: string | null;
  postalCode: string | null;
  departmentCode: string | null;
  latitude: number | null;
  longitude: number | null;
  locationLabel: string | null;
} {
  const lieu = offer.lieuTravail;
  const communeCode = lieu?.commune ?? null;
  const postalCode = lieu?.codePostal ?? null;

  let departmentCode: string | null = null;
  if (communeCode) departmentCode = departmentCodeFromCommuneCode(communeCode);
  else if (postalCode) departmentCode = departmentCodeFromPostalCode(postalCode);

  return {
    communeCode,
    postalCode,
    departmentCode,
    latitude: lieu?.latitude ?? null,
    longitude: lieu?.longitude ?? null,
    locationLabel: cleanLocationLabel(lieu?.libelle),
  };
}

function mapSourceUrl(offer: FranceTravailOffer, id: string): string {
  const urlOrigine = offer.origineOffre?.urlOrigine;
  return isHttpUrl(urlOrigine) ? urlOrigine : `${FALLBACK_OFFER_URL}${id}`;
}

/**
 * Normalise une offre France Travail (déjà validée par le schéma Zod) en
 * `JobDraft`. Renvoie `null` si l'offre n'a ni identifiant ni intitulé —
 * inexploitable, jamais bloquant pour le reste du lot (l'ingestion l'ignore
 * et la compte, spec §5).
 */
export function mapFranceTravailOffer(offer: FranceTravailOffer, now: Date = new Date()): JobDraft | null {
  const id = offer.id;
  const title = offer.intitule;
  if (!id || !title) return null;

  const { contractType, isApprenticeship } = mapContract(offer);
  const { level: experienceLevel, required: experienceRequired } = mapExperience(
    offer.experienceExige,
    offer.experienceLibelle,
  );
  const { minAnnual: salaryMinAnnual, maxAnnual: salaryMaxAnnual } = parseSalaryLabel(offer.salaire?.libelle);
  const description = cleanText(offer.description ?? '', MAX_DESCRIPTION_LENGTH);
  const remoteMode = detectRemoteMode(`${title}\n${offer.description ?? ''}`);
  const location = mapLocation(offer);

  const companyNom = offer.entreprise?.nom;
  const companyName = companyNom ? cleanText(companyNom, MAX_COMPANY_NAME_LENGTH) : null;
  const companyDescriptionRaw = offer.entreprise?.description;
  const companyDescription = companyDescriptionRaw
    ? cleanText(companyDescriptionRaw, MAX_COMPANY_DESCRIPTION_LENGTH)
    : null;
  const companyUrlRaw = offer.entreprise?.url;
  const companyLogoRaw = offer.entreprise?.logo;
  const applyUrlRaw = offer.contact?.urlPostulation;
  const salaireLibelle = offer.salaire?.libelle;

  const publishedAt = parseDateOrNull(offer.dateCreation) ?? parseDateOrNull(offer.dateActualisation) ?? now;
  const sourceUpdatedAt = parseDateOrNull(offer.dateActualisation);

  return {
    title,
    company: companyName,
    companyDescription,
    companyUrl: isHttpUrl(companyUrlRaw) ? companyUrlRaw : null,
    companyLogoUrl: isHttpUrl(companyLogoRaw) ? companyLogoRaw : null,
    description,
    locationLabel: location.locationLabel,
    communeCode: location.communeCode,
    postalCode: location.postalCode,
    departmentCode: location.departmentCode,
    latitude: location.latitude,
    longitude: location.longitude,
    contractType,
    contractLabel: offer.typeContratLibelle ?? offer.typeContrat ?? null,
    contractNature: offer.natureContrat ?? null,
    remoteMode,
    remoteModeInferred: remoteMode !== null,
    experienceLevel,
    experienceLabel: offer.experienceLibelle ?? null,
    experienceRequired,
    salaryMinAnnual,
    salaryMaxAnnual,
    salaryLabel: salaireLibelle ? cleanText(salaireLibelle, MAX_SALARY_LABEL_LENGTH) : null,
    currency: 'EUR',
    workingTimeLabel: offer.dureeTravailLibelle ?? null,
    isFullTime: offer.tempsPlein ?? null,
    isApprenticeship,
    positionsCount: offer.nombrePostes ?? null,
    accessibleTh: offer.accessibleTH ?? null,
    sectorLabel: offer.secteurActiviteLibelle ?? null,
    romeCode: offer.romeCode ?? null,
    romeLabel: offer.romeLibelle ?? null,
    qualificationLabel: offer.qualificationLibelle ?? null,
    publishedAt,
    sourceUpdatedAt,
    skills: mapSkills(offer),
    requirements: mapRequirements(offer),
    source: {
      kind: 'FRANCE_TRAVAIL',
      externalId: id,
      url: mapSourceUrl(offer, id),
      applyUrl: isHttpUrl(applyUrlRaw) ? applyUrlRaw : null,
      partnerName: offer.origineOffre?.partenaires?.[0]?.nom ?? null,
      publishedAt,
      sourceUpdatedAt,
    },
  };
}
