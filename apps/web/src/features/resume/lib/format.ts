import type { ResumeContentLanguage, ResumeContentSkill } from '@jobtrack/shared';
import { formatMonthYear } from '@/lib/dates';

/**
 * Libellés des niveaux de compétence (spec §4, `resumeContentSchema.skills[].level`).
 * Copie volontaire de `features/profile/sections/skills-section.tsx` (`LEVEL_LABELS`,
 * non exporté) : le CV n'a pas de dépendance vers le formulaire de profil, et ce
 * dernier ne partage aujourd'hui aucune table de libellés.
 */
export const SKILL_LEVEL_LABELS: Record<ResumeContentSkill['level'], string> = {
  BEGINNER: 'Débutant',
  INTERMEDIATE: 'Intermédiaire',
  ADVANCED: 'Avancé',
  EXPERT: 'Expert',
};

/**
 * Libellés des niveaux de langue (spec §4, `resumeContentSchema.languages[].level`).
 * Copie volontaire de `features/profile/sections/languages-section.tsx` (`LEVEL_LABELS`,
 * non exporté), même raison que ci-dessus.
 */
export const LANGUAGE_LEVEL_LABELS: Record<ResumeContentLanguage['level'], string> = {
  A1: 'A1',
  A2: 'A2',
  B1: 'B1',
  B2: 'B2',
  C1: 'C1',
  C2: 'C2',
  NATIVE: 'Langue maternelle',
};

export function formatSkillLevel(level: ResumeContentSkill['level']): string {
  return SKILL_LEVEL_LABELS[level];
}

export function formatLanguageLevel(level: ResumeContentLanguage['level']): string {
  return LANGUAGE_LEVEL_LABELS[level];
}

/**
 * Période affichée pour une expérience/formation/certification (spec tâche 6 :
 * « mars 2022 – aujourd'hui »). `start`/`end` sont des dates `AAAA-MM-JJ` ou
 * `null` (schéma `resumeContentSchema`, champ optionnel non résolu) ;
 * `isCurrent` (uniquement porté par les expériences) force le suffixe
 * « aujourd'hui » quel que soit `end` (la base du CV met déjà `endDate` à
 * `null` dans ce cas, mais un contenu édité à la main ne le garantit pas).
 *
 * Sans `isCurrent` ni `end`, un `start` seul est complété par « en cours »
 * plutôt que laissé nu : une formation ou certification en cours n'a pas de
 * champ `isCurrent` dédié dans le schéma, seule l'absence de date de fin le
 * signale.
 */
export function formatDateRange(start: string | null, end: string | null, isCurrent = false): string {
  const startLabel = start ? formatMonthYear(start) : null;

  if (isCurrent) {
    return startLabel ? `${startLabel} – aujourd'hui` : "Aujourd'hui";
  }

  if (end) {
    const endLabel = formatMonthYear(end);
    return startLabel ? `${startLabel} – ${endLabel}` : endLabel;
  }

  if (startLabel) return `${startLabel} – en cours`;

  return '';
}
