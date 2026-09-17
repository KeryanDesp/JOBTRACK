import type { JobRequirements, MatchEvidenceDto, MatchFactorDto } from '@jobtrack/shared';
import { canonicalSkill } from '../normalize';
import type { JobInputs, ProfileInputs } from '../types';
import { evaluatedFactor, unknownFactor } from './support';

interface EffectiveTechnology {
  name: string;
  required: boolean;
}

/**
 * Technologies effectivement utilisées par le facteur : celles extraites par
 * l'analyse (`requirements.technologies`) si elle en a trouvé au moins une,
 * sinon un repli sur les compétences France Travail brutes (`JobSkill`, spec
 * §5 : « sans technologie exigée dans l'annonce → sur les compétences France
 * Travail »).
 */
export function effectiveTechnologies(job: JobInputs, requirements: JobRequirements): EffectiveTechnology[] {
  if (requirements.technologies.length > 0) {
    return requirements.technologies.map((technology) => ({ name: technology.name, required: technology.required }));
  }
  return job.skills.map((skill) => ({ name: skill.name, required: skill.required }));
}

/** Ensemble des compétences du profil (compétences déclarées + technologies de projets), sous forme de clés canoniques. */
export function buildProfileSkillSet(profile: ProfileInputs): ReadonlySet<string> {
  const set = new Set<string>();
  for (const skill of profile.skills) set.add(canonicalSkill(skill.name));
  for (const technology of profile.projectTechnologies) set.add(canonicalSkill(technology));
  return set;
}

/**
 * `true` si toutes les technologies exigées (`required: true`) sont couvertes
 * par le profil — condition de la priorité `VERY_HIGH` (spec §5). Vacuously
 * `true` quand aucune technologie n'est exigée.
 */
export function allRequiredTechnologiesCovered(profile: ProfileInputs, job: JobInputs, requirements: JobRequirements): boolean {
  const required = effectiveTechnologies(job, requirements).filter((technology) => technology.required);
  if (required.length === 0) return true;
  const skillSet = buildProfileSkillSet(profile);
  return required.every((technology) => skillSet.has(canonicalSkill(technology.name)));
}

/** Couverture (0 à 1) d'une liste de technologies par le profil, en collectant une ligne d'évidence par technologie. `null` si la liste est vide (rien à couvrir). */
function coverage(technologies: readonly EffectiveTechnology[], skillSet: ReadonlySet<string>, evidence: MatchEvidenceDto[]): number | null {
  if (technologies.length === 0) return null;
  let matched = 0;
  for (const technology of technologies) {
    const present = skillSet.has(canonicalSkill(technology.name));
    if (present) matched += 1;
    evidence.push({
      kind: present ? 'ok' : technology.required ? 'missing' : 'warn',
      text: present
        ? `${technology.name} correspond`
        : technology.required
          ? `${technology.name} exigé, absent de votre profil`
          : `${technology.name} souhaité, absent de votre profil`,
    });
  }
  return matched / technologies.length;
}

/**
 * Facteur Compétences et technologies (poids 35, spec §5) : 70 % de couverture
 * des technologies exigées + 30 % de couverture des technologies souhaitées,
 * comparées au profil via `canonicalSkill` (normalisation + synonymes).
 * `unknown` quand l'offre ne porte aucune technologie, ni extraite par
 * l'analyse ni issue de France Travail.
 */
export function scoreSkills(profile: ProfileInputs, job: JobInputs, requirements: JobRequirements, _now: Date): MatchFactorDto {
  const technologies = effectiveTechnologies(job, requirements);
  if (technologies.length === 0) {
    return unknownFactor('skills', "Aucune technologie n'a été identifiée pour cette offre.");
  }

  const required = technologies.filter((technology) => technology.required);
  const nice = technologies.filter((technology) => !technology.required);
  const skillSet = buildProfileSkillSet(profile);

  const evidence: MatchEvidenceDto[] = [];
  const requiredCoverage = coverage(required, skillSet, evidence);
  const niceCoverage = coverage(nice, skillSet, evidence);

  // Répartition 70/30 (spec §5), renormalisée sur les seules catégories présentes
  // dans l'offre : une offre sans aucune technologie « nice to have » ne doit pas
  // recevoir 30 points gratuits pour une liste vide (couverture vacueuse).
  let weightedSum = 0;
  let appliedWeight = 0;
  if (requiredCoverage !== null) {
    weightedSum += requiredCoverage * 70;
    appliedWeight += 70;
  }
  if (niceCoverage !== null) {
    weightedSum += niceCoverage * 30;
    appliedWeight += 30;
  }
  const score = Math.round((weightedSum / appliedWeight) * 100);

  return evaluatedFactor('skills', score, evidence);
}
