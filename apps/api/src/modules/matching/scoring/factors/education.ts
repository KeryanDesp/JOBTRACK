import { EDUCATION_LEVELS, type JobRequirements, type MatchFactorDto } from '@jobtrack/shared';
import { EDUCATION_LEVEL_LABELS } from '../education-level';
import type { JobInputs, ProfileInputs } from '../types';
import { evaluatedFactor, unknownFactor } from './support';

/**
 * Facteur Formation (poids 5, spec §5) : niveau de formation exigé par
 * l'analyse comparé au niveau maximal du profil. Niveau atteint ou dépassé →
 * 100, un cran en dessous → 60, plus bas → 20. `unknown` si l'offre n'exige
 * aucun niveau (`educationLevel` absent ou `none`).
 */
export function scoreEducation(profile: ProfileInputs, _job: JobInputs, requirements: JobRequirements, _now: Date): MatchFactorDto {
  const required = requirements.educationLevel;
  if (required === null || required === 'none') {
    return unknownFactor('education', "L'offre n'indique pas de niveau de formation requis.");
  }

  const profileLevel = profile.educationLevel ?? 'none';
  const diff = EDUCATION_LEVELS.indexOf(required) - EDUCATION_LEVELS.indexOf(profileLevel);
  const text = `Niveau demandé : ${EDUCATION_LEVEL_LABELS[required]}, votre niveau : ${EDUCATION_LEVEL_LABELS[profileLevel]}`;

  if (diff <= 0) return evaluatedFactor('education', 100, [{ kind: 'ok', text }]);
  if (diff === 1) return evaluatedFactor('education', 60, [{ kind: 'warn', text }]);
  return evaluatedFactor('education', 20, [{ kind: 'missing', text }]);
}
