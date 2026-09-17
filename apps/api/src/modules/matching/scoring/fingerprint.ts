import { createHash } from 'node:crypto';
import { SYNONYMS_VERSION } from './synonyms';
import { SCORING_VERSION, type ProfileInputs } from './types';

function sortedStrings(values: readonly string[]): string[] {
  return [...values].sort();
}

/**
 * Représentation canonique et stable de `ProfileInputs` : tableaux triés pour
 * être insensible à l'ordre de saisie, dates converties en ISO. Utilisée
 * uniquement pour construire l'empreinte (jamais renvoyée telle quelle).
 */
function canonicalize(profile: ProfileInputs): unknown {
  return {
    skills: [...profile.skills]
      .map((skill) => ({ name: skill.name, level: skill.level }))
      .sort((a, b) => a.name.localeCompare(b.name) || a.level.localeCompare(b.level)),
    projectTechnologies: sortedStrings(profile.projectTechnologies),
    experienceYears: profile.experienceYears,
    experiences: [...profile.experiences]
      .map((experience) => ({
        startDate: experience.startDate.toISOString(),
        endDate: experience.endDate ? experience.endDate.toISOString() : null,
        isCurrent: experience.isCurrent,
      }))
      .sort((a, b) => a.startDate.localeCompare(b.startDate) || (a.endDate ?? '').localeCompare(b.endDate ?? '')),
    educationLevel: profile.educationLevel,
    languages: [...profile.languages]
      .map((language) => ({ name: language.name, level: language.level }))
      .sort((a, b) => a.name.localeCompare(b.name) || a.level.localeCompare(b.level)),
    preferredCommuneCodes: sortedStrings(profile.preferredCommuneCodes),
    preferredDepartmentCodes: sortedStrings(profile.preferredDepartmentCodes),
    // Amendement revue (spec §5, facteur Localisation) : un libellé de lieu souhaité modifié
    // sans changer la résolution (ex. correction d'une faute de frappe qui reste non reconnue)
    // doit tout de même invalider un score déjà calculé, pour que l'explication reflète le
    // libellé actuel plutôt qu'un ancien.
    preferredLocationLabels: sortedStrings(profile.preferredLocationLabels),
    salaryMin: profile.salaryMin,
    salaryMax: profile.salaryMax,
    contractTypes: sortedStrings(profile.contractTypes),
    remoteModes: sortedStrings(profile.remoteModes),
    experienceLevel: profile.experienceLevel,
    complete: profile.complete,
  };
}

/**
 * Empreinte sha256 des entrées profil utilisées par le moteur (spec §5,
 * « Empreinte du profil ») : inclut `SCORING_VERSION` et `SYNONYMS_VERSION`
 * pour qu'une évolution du moteur ou de la table de synonymes déclenche un
 * recalcul automatique, même si le profil n'a pas changé.
 */
export function profileFingerprint(profile: ProfileInputs): string {
  const payload = JSON.stringify({
    scoringVersion: SCORING_VERSION,
    synonymsVersion: SYNONYMS_VERSION,
    profile: canonicalize(profile),
  });
  return createHash('sha256').update(payload).digest('hex');
}
