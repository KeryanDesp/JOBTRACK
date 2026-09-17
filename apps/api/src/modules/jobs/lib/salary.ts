/**
 * Interprétation du libellé de salaire France Travail (`salaire.libelle`) en
 * fourchette annuelle. Toujours prudent : un libellé qui ne suit aucun des
 * motifs reconnus renvoie `null` des deux côtés plutôt qu'une estimation —
 * le cahier des charges l'interdit explicitement (§5).
 */

/** Nombre moyen d'heures mensuelles utilisé par France Travail pour convertir un taux horaire (35h/semaine × 52 / 12). */
const HOURS_PER_MONTH = 151.67;
const MONTHS_PER_YEAR = 12;

export interface SalaryRange {
  minAnnual: number | null;
  maxAnnual: number | null;
}

/** Un nombre au format France Travail : chiffres, espaces (séparateur de milliers), virgule ou point décimal. */
const NUMBER_PATTERN = String.raw`\d[\d\s]*(?:[.,]\d+)?`;

const MENSUEL_PATTERN = new RegExp(
  `^Mensuel de (${NUMBER_PATTERN}) Euros?(?: à (${NUMBER_PATTERN}) Euros?)?(?: sur (${NUMBER_PATTERN}) mois)?`,
  'i',
);
const ANNUEL_PATTERN = new RegExp(`^Annuel de (${NUMBER_PATTERN}) Euros?(?: à (${NUMBER_PATTERN}) Euros?)?`, 'i');
const HORAIRE_PATTERN = new RegExp(`^Horaire de (${NUMBER_PATTERN}) Euros?(?: à (${NUMBER_PATTERN}) Euros?)?`, 'i');

/** Convertit un nombre France Travail (« 2 500,00 », « 45000.00 », « 12.50 ») en `number`. */
function parseAmount(raw: string): number {
  const normalized = raw.trim().replace(/\s+/g, '').replace(',', '.');
  return Number.parseFloat(normalized);
}

function round(value: number): number {
  return Math.round(value);
}

/**
 * Interprète `label` selon les motifs France Travail connus : mensuel (× mois),
 * annuel (direct), horaire (× 151,67 h/mois × 12 mois). Tout le reste — « Selon
 * profil », « Cachet de… », une fourchette sans période explicite, un libellé
 * absent — renvoie `{ minAnnual: null, maxAnnual: null }`.
 */
export function parseSalaryLabel(label: string | null | undefined): SalaryRange {
  if (!label) return { minAnnual: null, maxAnnual: null };
  const trimmed = label.trim();

  const mensuel = MENSUEL_PATTERN.exec(trimmed);
  if (mensuel) {
    const min = parseAmount(mensuel[1] ?? '0');
    const max = mensuel[2] ? parseAmount(mensuel[2]) : min;
    const months = mensuel[3] ? parseAmount(mensuel[3]) : MONTHS_PER_YEAR;
    return { minAnnual: round(min * months), maxAnnual: round(max * months) };
  }

  const annuel = ANNUEL_PATTERN.exec(trimmed);
  if (annuel) {
    const min = parseAmount(annuel[1] ?? '0');
    const max = annuel[2] ? parseAmount(annuel[2]) : min;
    return { minAnnual: round(min), maxAnnual: round(max) };
  }

  const horaire = HORAIRE_PATTERN.exec(trimmed);
  if (horaire) {
    const min = parseAmount(horaire[1] ?? '0');
    const max = horaire[2] ? parseAmount(horaire[2]) : min;
    return {
      minAnnual: round(min * HOURS_PER_MONTH * MONTHS_PER_YEAR),
      maxAnnual: round(max * HOURS_PER_MONTH * MONTHS_PER_YEAR),
    };
  }

  return { minAnnual: null, maxAnnual: null };
}
