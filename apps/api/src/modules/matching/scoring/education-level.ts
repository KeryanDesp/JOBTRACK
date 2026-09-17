import { EDUCATION_LEVELS, type EducationLevel } from '@jobtrack/shared';
import { normalizeForKey } from '../../jobs/lib/text';

/** Libellés français des niveaux de formation, réutilisés par le facteur Formation et l'explication. */
export const EDUCATION_LEVEL_LABELS: Record<EducationLevel, string> = {
  none: 'Aucun niveau requis',
  bac: 'Bac',
  bac2: 'Bac+2',
  bac3: 'Bac+3',
  bac5: 'Bac+5',
  phd: 'Doctorat',
};

/**
 * `true` si `key` (déjà passée par `normalizeForKey`) correspond à l'un des
 * motifs : un motif à un seul mot (« bac », « cap »…) doit correspondre à un
 * mot entier de `key` — sinon « handicap » matcherait le motif « cap » — un
 * motif à plusieurs mots (« sans diplome », « bac 5»…) reste une simple
 * sous-chaîne, suffisamment spécifique pour ne pas avoir besoin de bornes.
 */
function includesAny(key: string, needles: readonly string[]): boolean {
  const words = key.split(' ');
  return needles.some((needle) => (needle.includes(' ') ? key.includes(needle) : words.includes(needle)));
}

/**
 * Motifs de reconnaissance d'un `degree` libre (formulaire « Formation » du
 * profil) vers un `EducationLevel`, testés dans cet ordre : les motifs les
 * plus spécifiques d'abord (« bac 5 » avant « bac »), pour qu'un diplôme
 * « Master » ne retombe jamais sur le niveau générique `bac`. « Bac+4 » n'a
 * pas de palier dédié dans `EDUCATION_LEVELS` : il est rattaché au palier
 * inférieur le plus proche, `bac3`. Les niveaux RNCP 6 et 7 correspondent
 * respectivement à une licence (bac3) et un master (bac5) dans la
 * nomenclature nationale des certifications professionnelles.
 */
const DEGREE_PATTERNS: readonly { level: EducationLevel; needles: readonly string[] }[] = [
  { level: 'none', needles: ['cap', 'bep', 'sans diplome'] },
  { level: 'phd', needles: ['doctorat', 'phd'] },
  { level: 'bac5', needles: ['master', 'ingenieur', 'mba', 'bac 5', 'bac5', 'rncp niveau 7'] },
  { level: 'bac3', needles: ['licence', 'bachelor', 'bac 3', 'bac3', 'bac 4', 'bac4', 'rncp niveau 6'] },
  { level: 'bac2', needles: ['bts', 'dut', 'deug', 'bac 2', 'bac2'] },
  { level: 'bac', needles: ['baccalaureat', 'bac'] },
];

/**
 * Déduit un `EducationLevel` d'un intitulé de diplôme libre (« BTS », « Bac+5 »,
 * « Diplôme d'ingénieur »…), insensible aux accents et à la casse
 * (`normalizeForKey`). Renvoie `null` si aucun motif connu ne correspond
 * (spec §5, table `degree` → niveau).
 */
export function educationLevelFromDegree(degree: string): EducationLevel | null {
  const key = normalizeForKey(degree);
  for (const pattern of DEGREE_PATTERNS) {
    if (includesAny(key, pattern.needles)) return pattern.level;
  }
  return null;
}

/** Niveau de formation le plus élevé parmi une liste (ordre `EDUCATION_LEVELS`), ou `null` si aucun n'est connu. */
export function maxEducationLevel(levels: readonly (EducationLevel | null)[]): EducationLevel | null {
  let max: EducationLevel | null = null;
  for (const level of levels) {
    if (level === null) continue;
    if (max === null || EDUCATION_LEVELS.indexOf(level) > EDUCATION_LEVELS.indexOf(max)) {
      max = level;
    }
  }
  return max;
}
