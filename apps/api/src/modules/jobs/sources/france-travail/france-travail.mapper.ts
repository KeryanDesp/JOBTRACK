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

const MAX_LABEL_LENGTH = 200;
const MAX_DESCRIPTION_LENGTH = 20_000;
const MAX_COMPANY_NAME_LENGTH = 200;
const MAX_COMPANY_DESCRIPTION_LENGTH = 5_000;
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

const POSTAL_CODE_PATTERN = /^\d{5}$/;

/**
 * Un code commune ou un code postal exploitable : cinq chiffres, ou (Corse)
 * `2A`/`2B` suivi de trois chiffres pour un code commune. Une valeur qui ne
 * respecte pas ce format (source hostile ou champ mal renseigné) devient
 * `null` plutôt que d'être propagée telle quelle jusqu'en base.
 */
const LOCATION_CODE_PATTERN = /^\d{5}$|^2[AB]\d{3}$/;

function cleanLocationCode(value: string | null | undefined): string | null {
  if (!value) return null;
  return LOCATION_CODE_PATTERN.test(value) ? value : null;
}

function isHttpUrl(value: string | null | undefined): value is string {
  return typeof value === 'string' && /^https?:\/\//i.test(value);
}

/**
 * Nettoie un libellé texte (contrôles, bidi, troncature à `max`) et renvoie
 * `null` si le résultat est vide — un libellé réduit à des caractères de
 * contrôle ou à des espaces n'est pas exploitable, jamais une chaîne vide
 * silencieuse.
 */
function cleanLabel(value: string | null | undefined, max: number = MAX_LABEL_LENGTH): string | null {
  if (!value) return null;
  const cleaned = cleanText(value, max);
  return cleaned.length > 0 ? cleaned : null;
}

/** Parse une date ISO France Travail ; renvoie `null` si absente ou invalide (jamais une exception). */
function parseDateOrNull(value: string | null | undefined): Date | null {
  if (!value) return null;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

/** `nombrePostes` n'est un nombre de postes exploitable que s'il s'agit d'un entier strictement positif. */
function positiveInteger(value: number | null | undefined): number | null {
  if (typeof value !== 'number' || !Number.isInteger(value) || value <= 0) return null;
  return value;
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

/**
 * Repli sur le code postal quand `commune` est absent : `null` si le code
 * postal n'a pas cinq chiffres, ou s'il commence par `20` — la Corse a deux
 * départements (`2A`/`2B`) indiscernables depuis le seul code postal, jamais
 * deviné. DOM (`97x`/`98x`) : trois premiers caractères, comme pour la commune.
 */
function departmentCodeFromPostalCode(postalCode: string): string | null {
  if (!POSTAL_CODE_PATTERN.test(postalCode)) return null;
  if (postalCode.startsWith('20')) return null;
  if (postalCode.startsWith('97') || postalCode.startsWith('98')) return postalCode.slice(0, 3);
  return postalCode.slice(0, 2);
}

function mapSkills(offer: FranceTravailOffer): JobDraftSkill[] {
  const seen = new Set<string>();
  const skills: JobDraftSkill[] = [];
  for (const competence of offer.competences) {
    const name = cleanLabel(competence.libelle);
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
    const rawLabel = [formation.niveauLibelle, formation.domaineLibelle].filter(Boolean).join(' – ');
    const label = cleanLabel(rawLabel);
    if (!label) continue;
    requirements.push({ kind: 'EDUCATION', label, required: formation.exigence === 'E' });
  }

  for (const langue of offer.langues) {
    const label = cleanLabel(langue.libelle);
    if (!label) continue;
    requirements.push({ kind: 'LANGUAGE', label, required: langue.exigence === 'E' });
  }

  return requirements;
}

/**
 * Contrat + nature (apprentissage) : l'apprentissage prévaut sur le code
 * `typeContrat` sous-jacent. `Object.hasOwn` (et non un simple accès `[code]`)
 * évite qu'un code inattendu comme `constructor` ne résolve une propriété
 * héritée du prototype de l'objet plutôt que `undefined`.
 */
function mapContract(offer: FranceTravailOffer): { contractType: ContractType | null; isApprenticeship: boolean } {
  const isApprenticeship =
    (offer.natureContrat != null && APPRENTICESHIP_NATURE_CODES.has(offer.natureContrat)) ||
    offer.alternance === true;

  if (isApprenticeship) return { contractType: 'APPRENTICESHIP', isApprenticeship: true };

  const code = offer.typeContrat;
  const contractType =
    code && Object.hasOwn(CONTRACT_TYPE_BY_CODE, code) ? CONTRACT_TYPE_BY_CODE[code] ?? null : null;
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
  const communeCode = cleanLocationCode(lieu?.commune);
  const postalCode = cleanLocationCode(lieu?.codePostal);

  let departmentCode: string | null = null;
  if (communeCode) departmentCode = departmentCodeFromCommuneCode(communeCode);
  else if (postalCode) departmentCode = departmentCodeFromPostalCode(postalCode);

  return {
    communeCode,
    postalCode,
    departmentCode,
    latitude: lieu?.latitude ?? null,
    longitude: lieu?.longitude ?? null,
    locationLabel: cleanLocationLabel(cleanLabel(lieu?.libelle)),
  };
}

/** URL de repli vers la fiche candidat : `id` échappé, une offre France Travail pouvant contenir `/` ou des espaces. */
function mapSourceUrl(offer: FranceTravailOffer, id: string): string {
  const urlOrigine = offer.origineOffre?.urlOrigine;
  return isHttpUrl(urlOrigine) ? urlOrigine : `${FALLBACK_OFFER_URL}${encodeURIComponent(id)}`;
}

/**
 * Normalise une offre France Travail (déjà validée par le schéma Zod) en
 * `JobDraft`. Renvoie `null` si l'offre n'a ni identifiant ni intitulé
 * exploitable (vide, ou réduit à des espaces/caractères de contrôle une fois
 * nettoyé) — inexploitable, jamais bloquant pour le reste du lot (l'ingestion
 * l'ignore et la compte, spec §5).
 */
export function mapFranceTravailOffer(offer: FranceTravailOffer, now: Date = new Date()): JobDraft | null {
  const id = offer.id;
  const title = cleanLabel(offer.intitule);
  if (!id || !title) return null;

  const { contractType, isApprenticeship } = mapContract(offer);
  const experienceLabel = cleanLabel(offer.experienceLibelle);
  const { level: experienceLevel, required: experienceRequired } = mapExperience(
    offer.experienceExige,
    experienceLabel,
  );
  const { minAnnual: salaryMinAnnual, maxAnnual: salaryMaxAnnual } = parseSalaryLabel(offer.salaire?.libelle);
  const description = cleanText(offer.description ?? '', MAX_DESCRIPTION_LENGTH);
  const remoteMode = detectRemoteMode(`${title}\n${offer.description ?? ''}`);
  const location = mapLocation(offer);

  const companyName = cleanLabel(offer.entreprise?.nom, MAX_COMPANY_NAME_LENGTH);
  const companyDescription = cleanLabel(offer.entreprise?.description, MAX_COMPANY_DESCRIPTION_LENGTH);
  const companyUrlRaw = offer.entreprise?.url;
  const companyLogoRaw = offer.entreprise?.logo;
  const applyUrlRaw = offer.contact?.urlPostulation;

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
    contractLabel: cleanLabel(offer.typeContratLibelle ?? offer.typeContrat),
    contractNature: cleanLabel(offer.natureContrat),
    remoteMode,
    remoteModeInferred: remoteMode !== null,
    experienceLevel,
    experienceLabel,
    experienceRequired,
    salaryMinAnnual,
    salaryMaxAnnual,
    salaryLabel: cleanLabel(offer.salaire?.libelle),
    currency: 'EUR',
    workingTimeLabel: cleanLabel(offer.dureeTravailLibelle),
    isFullTime: offer.tempsPlein ?? null,
    isApprenticeship,
    positionsCount: positiveInteger(offer.nombrePostes),
    accessibleTh: offer.accessibleTH ?? null,
    sectorLabel: cleanLabel(offer.secteurActiviteLibelle),
    romeCode: cleanLabel(offer.romeCode),
    romeLabel: cleanLabel(offer.romeLibelle),
    qualificationLabel: cleanLabel(offer.qualificationLibelle),
    publishedAt,
    sourceUpdatedAt,
    skills: mapSkills(offer),
    requirements: mapRequirements(offer),
    source: {
      kind: 'FRANCE_TRAVAIL',
      externalId: id,
      url: mapSourceUrl(offer, id),
      applyUrl: isHttpUrl(applyUrlRaw) ? applyUrlRaw : null,
      partnerName: cleanLabel(offer.origineOffre?.partenaires?.[0]?.nom),
      publishedAt,
      sourceUpdatedAt,
    },
  };
}
