import type { ExperienceLevel } from '@prisma/client';
import type { JobRequirements, MatchFactorDto, Seniority } from '@jobtrack/shared';
import { computeExperienceYears } from '../experience-years';
import type { JobInputs, ProfileInputs } from '../types';
import { evaluatedFactor, unknownFactor } from './support';

/** Années associées à chaque séniorité extraite par l'analyse (spec §5 : « 0/1/3/6 ans »). */
const SENIORITY_YEARS: Record<Seniority, number> = { junior: 1, mid: 3, senior: 6, lead: 6 };

/** Années associées au niveau d'expérience France Travail de l'offre (même barème que `SENIORITY_YEARS`). */
const EXPERIENCE_LEVEL_YEARS: Record<ExperienceLevel, number> = { STUDENT: 0, JUNIOR: 1, MID: 3, SENIOR: 6, LEAD: 6 };

/** Années d'expérience exigées : `experienceYearsMin` explicite, sinon la séniorité de l'analyse, sinon le niveau d'expérience France Travail. */
function requiredYears(job: JobInputs, requirements: JobRequirements): number | null {
  if (requirements.experienceYearsMin !== null) return requirements.experienceYearsMin;
  if (requirements.seniority !== null) return SENIORITY_YEARS[requirements.seniority];
  if (job.experienceLevel !== null) return EXPERIENCE_LEVEL_YEARS[job.experienceLevel];
  return null;
}

/** Années d'expérience du profil : calculées à partir des expériences si renseignées, sinon le champ manuel `experienceYears`. */
function actualYears(profile: ProfileInputs, now: Date): number | null {
  if (profile.experiences.length > 0) return computeExperienceYears(profile.experiences, now);
  return profile.experienceYears;
}

/** Formate un nombre d'années sans décimale superflue (`3` plutôt que `3.0`, `5.5` conservé). */
function formatYears(years: number): string {
  return Number.isInteger(years) ? `${years}` : years.toFixed(1);
}

/**
 * Facteur Expérience (poids 15, spec §5) : compare les années d'expérience du
 * profil aux années exigées par l'offre. `experienceRequired === false`
 * (« Débutant accepté ») vaut toujours 100, avant toute autre règle. `unknown`
 * seulement quand ni le profil ni l'offre ne portent d'information
 * d'expérience.
 */
export function scoreExperience(profile: ProfileInputs, job: JobInputs, requirements: JobRequirements, now: Date): MatchFactorDto {
  if (job.experienceRequired === false) {
    return evaluatedFactor('experience', 100, [{ kind: 'ok', text: 'Débutant accepté' }]);
  }

  const required = requiredYears(job, requirements);
  const actual = actualYears(profile, now);

  if (required === null && actual === null) {
    return unknownFactor('experience', "Aucune information d'expérience n'est disponible.");
  }

  const req = required ?? 0;
  const act = actual ?? 0;
  const text =
    req === 0
      ? "Aucune expérience minimale n'est exigée."
      : `${formatYears(req)} an(s) demandé(s), vous en avez ${formatYears(act)}`;

  if (act >= req) {
    return evaluatedFactor('experience', 100, [{ kind: 'ok', text }]);
  }

  const shortfall = req - act;
  if (shortfall <= 1) return evaluatedFactor('experience', 70, [{ kind: 'warn', text }]);
  if (shortfall <= 2) return evaluatedFactor('experience', 40, [{ kind: 'warn', text }]);
  return evaluatedFactor('experience', 15, [{ kind: 'missing', text }]);
}
