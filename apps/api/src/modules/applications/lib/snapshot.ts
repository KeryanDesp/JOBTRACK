import { formatSalaryRange, httpUrlSchema, sanitizeText, type SanitizeTextOptions } from '@jobtrack/shared';
import type { ApplicationSource, CreateManualInput } from '@jobtrack/shared';

/**
 * Instantané figé d'une candidature (spec §5) : les champs recopiés une fois pour toutes à la
 * création, l'offre d'origine pouvant expirer ou disparaître du catalogue.
 *
 * Tout ce qui est ici est **pur** (aucun accès base) : nettoyage de texte, bornes, choix du
 * lien et du libellé de salaire. `snapshotFromJob`, qui lit l'offre, reste dans le service.
 */

// Bornes du contrat partagé (`applications.ts`) appliquées aussi à l'instantané pris depuis
// une offre : le titre d'une offre France Travail peut dépasser `jobTitle` (160), et un DTO
// renvoyé doit toujours rester dans les bornes que le `PATCH` accepterait ensuite.
export const MAX_JOB_TITLE = 160;
export const MAX_COMPANY = 120;
export const MAX_LOCATION_LABEL = 120;
export const MAX_SALARY_LABEL = 80;
export const MAX_CONTRACT_LABEL = 80;
export const MAX_NOTES = 4000;

/** Les notes sont le seul champ multi-paragraphes d'une candidature : leurs sauts de ligne
 * sont conservés, les autres caractères de contrôle retirés comme ailleurs. */
export const NOTES_OPTIONS: SanitizeTextOptions = { multiline: true };

export interface ApplicationSnapshot {
  jobId: string | null;
  jobTitle: string;
  company: string | null;
  locationLabel: string | null;
  salaryLabel: string | null;
  contractLabel: string | null;
  source: ApplicationSource;
  sourceUrl: string | null;
  notes: string | null;
}

/**
 * Texte d'une candidature : nettoyage du **contrat partagé** (`sanitizeText` — contrôles C0/C1,
 * DEL, caractères de largeur nulle, marques et isolats bidi, BOM ; tabulation ramenée à un
 * espace ; sauts de ligne conservés pour les seules notes) puis borne appliquée. Le contrat
 * nettoie déjà les corps de requête ; le service refait le même nettoyage pour ses propres
 * entrées (instantané pris depuis une offre, appel direct du service) — jamais de texte non
 * assaini écrit en base, et exactement les mêmes règles des deux côtés.
 *
 * La borne est appliquée sur des **points de code** (`Array.from`) et non sur des unités
 * UTF-16 : un `slice` brut couperait un emoji ou un idéogramme hors plan de base en deux
 * demi-paires de substitution, laissant un caractère de remplacement en fin de champ. Le
 * `trim` final retire l'espace qu'une coupure peut laisser en bordure.
 */
export function boundedText(value: string, max: number, options: SanitizeTextOptions = {}): string {
  const cleaned = sanitizeText(value, options);
  const points = Array.from(cleaned);
  return (points.length <= max ? cleaned : points.slice(0, max).join('')).trim();
}

/** Même nettoyage, une chaîne vide (ou absente) devenant `null` : une colonne optionnelle ne
 * porte jamais `''`, qui s'afficherait comme une valeur présente mais vide. */
export function boundedOptionalText(
  value: string | null | undefined,
  max: number,
  options: SanitizeTextOptions = {},
): string | null {
  if (value === null || value === undefined) return null;
  const cleaned = boundedText(value, max, options);
  return cleaned === '' ? null : cleaned;
}

/**
 * Lien externe affichable (spec §5) : exactement la règle du contrat partagé (`httpUrlSchema` —
 * `http(s)` uniquement, borné à 500 caractères, sans identifiants embarqués ni caractère de
 * contrôle/bidi). Réutiliser le schéma plutôt qu'un `new URL()` local évite qu'un lien refusé
 * à la saisie (`http://banque.example@piege.example/`, qui n'affiche pas l'hôte réellement
 * visité) soit accepté par le chemin « instantané d'une offre ».
 */
export function isDisplayableHttpUrl(value: string | null | undefined): value is string {
  return value != null && httpUrlSchema.safeParse(value).success;
}

/** Lien de candidature de l'offre : le premier `applyUrl` exploitable, sinon le premier `url`
 * (spec §5), les sources étant fournies de la plus récente à la plus ancienne. */
export function pickSourceUrl(sources: ReadonlyArray<{ applyUrl: string | null; url: string }>): string | null {
  for (const source of sources) {
    if (isDisplayableHttpUrl(source.applyUrl)) return source.applyUrl;
  }
  for (const source of sources) {
    if (isDisplayableHttpUrl(source.url)) return source.url;
  }
  return null;
}

/**
 * Salaire de l'instantané quand l'offre ne porte pas de libellé : la **même** mise en forme que
 * les écrans d'offres (`formatSalaryRange`, contrat partagé — « 45–55 k€ », « à partir de
 * 45 k€ »). Un montant s'affiche donc à l'identique sur l'offre et sur la candidature qui en
 * est née, au lieu des deux formats divergents d'avant. `null` quand aucune borne n'est connue —
 * jamais une estimation inventée (spec §5).
 */
export function formatSalarySnapshot(
  minAnnual: number | null,
  maxAnnual: number | null,
  currency: string,
): string | null {
  return formatSalaryRange(minAnnual, maxAnnual, currency);
}

/** Candidature saisie à la main (spec §2) : les champs tels que fournis, nettoyés et bornés. */
export function snapshotFromInput(input: CreateManualInput): ApplicationSnapshot {
  return {
    jobId: null,
    jobTitle: boundedText(input.jobTitle, MAX_JOB_TITLE),
    company: boundedOptionalText(input.company, MAX_COMPANY),
    locationLabel: boundedOptionalText(input.locationLabel, MAX_LOCATION_LABEL),
    salaryLabel: boundedOptionalText(input.salaryLabel, MAX_SALARY_LABEL),
    contractLabel: boundedOptionalText(input.contractLabel, MAX_CONTRACT_LABEL),
    source: input.source,
    sourceUrl: isDisplayableHttpUrl(input.sourceUrl) ? input.sourceUrl : null,
    notes: boundedOptionalText(input.notes, MAX_NOTES, NOTES_OPTIONS),
  };
}
