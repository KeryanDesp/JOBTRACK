import { CONTRACT_TYPE_LABELS, type JobRequirements, type MatchFactorDto } from '@jobtrack/shared';
import type { JobInputs, ProfileInputs } from '../types';
import { evaluatedFactor, unknownFactor } from './support';

/**
 * Facteur Contrat (poids 10, spec §5) : le type de contrat de l'offre
 * fait-il partie des types souhaités par le profil ? `unknown` si le profil
 * n'a exprimé aucune préférence de contrat, ou si l'offre n'indique pas de
 * type de contrat (rien à comparer dans les deux cas).
 */
export function scoreContract(profile: ProfileInputs, job: JobInputs, _requirements: JobRequirements, _now: Date): MatchFactorDto {
  if (profile.contractTypes.length === 0) {
    return unknownFactor('contract', "Vous n'avez pas indiqué de type de contrat souhaité.");
  }
  if (job.contractType === null) {
    return unknownFactor('contract', "L'offre n'indique pas de type de contrat.");
  }

  const label = CONTRACT_TYPE_LABELS[job.contractType];
  if (profile.contractTypes.includes(job.contractType)) {
    return evaluatedFactor('contract', 100, [{ kind: 'ok', text: `${label} fait partie de vos types de contrat souhaités.` }]);
  }
  return evaluatedFactor('contract', 20, [
    { kind: 'warn', text: `${label} ne fait pas partie de vos types de contrat souhaités.` },
  ]);
}
