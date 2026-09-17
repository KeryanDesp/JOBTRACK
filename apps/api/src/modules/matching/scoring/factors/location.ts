import type { JobRequirements, MatchFactorDto } from '@jobtrack/shared';
import { areNeighbours } from '../departments';
import type { JobInputs, ProfileInputs } from '../types';
import { evaluatedFactor, unknownFactor } from './support';

/**
 * Facteur Localisation (poids 15, spec §5) : une offre explicitement en
 * télétravail (analyse, pas la simple annotation heuristique de la tranche 3)
 * vaut 100 d'office ; sinon la commune de l'offre est comparée aux lieux
 * souhaités du profil (commune exacte 100, même département 80, département
 * limitrophe 60, sinon 20). `unknown` si l'offre n'a pas de commune ou si le
 * profil n'a indiqué aucun lieu souhaité — la distance kilométrique
 * (haversine) est hors périmètre (référentiel France Travail sans
 * coordonnées, cf. spec §5).
 */
export function scoreLocation(profile: ProfileInputs, job: JobInputs, requirements: JobRequirements, _now: Date): MatchFactorDto {
  if (requirements.remoteMode === 'remote') {
    return evaluatedFactor('location', 100, [
      { kind: 'ok', text: "Poste en télétravail : la localisation n'entre pas en compte." },
    ]);
  }

  const hasPreference = profile.preferredCommuneCodes.length > 0 || profile.preferredDepartmentCodes.length > 0;
  if (!job.communeCode) {
    return unknownFactor('location', "L'offre n'indique pas de localisation.");
  }
  if (!hasPreference) {
    return unknownFactor('location', "Vous n'avez pas indiqué de lieu souhaité.");
  }

  if (profile.preferredCommuneCodes.includes(job.communeCode)) {
    return evaluatedFactor('location', 100, [
      { kind: 'ok', text: 'Cette localisation fait partie de vos lieux souhaités.' },
    ]);
  }

  const departmentCode = job.departmentCode;
  if (departmentCode && profile.preferredDepartmentCodes.includes(departmentCode)) {
    return evaluatedFactor('location', 80, [{ kind: 'ok', text: "Même département qu'un lieu souhaité." }]);
  }

  if (departmentCode) {
    const neighbour = profile.preferredDepartmentCodes.some((preferred) => areNeighbours(preferred, departmentCode));
    if (neighbour) {
      return evaluatedFactor('location', 60, [{ kind: 'ok', text: 'Département limitrophe.' }]);
    }
  }

  return evaluatedFactor('location', 20, [
    { kind: 'warn', text: "Cette localisation est éloignée de vos lieux souhaités." },
  ]);
}
