import type { JobRequirements, MatchFactorDto } from '@jobtrack/shared';
import type { JobInputs, ProfileInputs } from '../types';
import { evaluatedFactor, unknownFactor } from './support';

/**
 * Facteur Salaire (poids 10, spec §5) : compare la fourchette annuelle de
 * l'offre au salaire minimum souhaité par le profil. `unknown` si l'offre
 * n'indique aucun salaire ou si le profil n'a pas exprimé d'attente.
 */
export function scoreSalary(profile: ProfileInputs, job: JobInputs, _requirements: JobRequirements, _now: Date): MatchFactorDto {
  const target = profile.salaryMin;
  if (target === null) {
    return unknownFactor('salary', "Vous n'avez pas indiqué de salaire souhaité.");
  }
  if (job.salaryMinAnnual === null && job.salaryMaxAnnual === null) {
    return unknownFactor('salary', "L'offre n'indique pas de salaire.");
  }

  const jobMin = job.salaryMinAnnual ?? job.salaryMaxAnnual;
  const jobMax = job.salaryMaxAnnual ?? job.salaryMinAnnual;

  if (jobMax !== null && jobMax < target) {
    return evaluatedFactor('salary', 30, [{ kind: 'warn', text: 'Salaire en dessous de votre attente.' }]);
  }
  if (jobMin !== null && jobMin >= target) {
    return evaluatedFactor('salary', 100, [{ kind: 'ok', text: 'Salaire au-dessus de votre attente.' }]);
  }
  return evaluatedFactor('salary', 75, [
    { kind: 'ok', text: "La fourchette de salaire de l'offre couvre partiellement votre attente." },
  ]);
}
