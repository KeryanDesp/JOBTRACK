import type { ExperienceLevel } from '@prisma/client';

/**
 * Traduction de `experienceExige` / `experienceLibelle` (France Travail) en
 * niveau d'expérience canonique. `D` (débutant accepté) est toujours
 * `JUNIOR` et non exigé ; `E`/`S` dépendent du libellé (« 3 An(s) », « 6 Mois »
 * — moins d'un an → `JUNIOR`, 1 à 3 ans → `MID`, plus de 3 ans → `SENIOR`).
 * Un libellé non exploitable ne fait jamais deviner un niveau : `level` reste
 * `null`, `required` reflète uniquement `experienceExige`.
 */

export interface ExperienceMapping {
  level: ExperienceLevel | null;
  required: boolean | null;
}

/** Extrait un nombre de mois d'un libellé (« 3 An(s) » → 36, « 6 Mois » → 6), ou `null` si non reconnu. */
function parseMonths(libelle: string): number | null {
  const match = /(\d+)\s*(an|mois)/i.exec(libelle);
  if (!match) return null;
  const amount = Number.parseInt(match[1] ?? '', 10);
  if (Number.isNaN(amount)) return null;
  return match[2]?.toLowerCase() === 'mois' ? amount : amount * 12;
}

function levelFromMonths(months: number): ExperienceLevel {
  if (months < 12) return 'JUNIOR';
  if (months <= 36) return 'MID';
  return 'SENIOR';
}

export function mapExperience(
  exige: string | null | undefined,
  libelle: string | null | undefined,
): ExperienceMapping {
  if (exige === 'D') return { level: 'JUNIOR', required: false };

  if (exige === 'E' || exige === 'S') {
    const required = exige === 'E';
    const months = libelle ? parseMonths(libelle) : null;
    if (months === null) return { level: null, required };
    return { level: levelFromMonths(months), required };
  }

  return { level: null, required: null };
}
