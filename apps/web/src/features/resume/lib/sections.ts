import type { ResumeContent, ResumeSection } from '@jobtrack/shared';

/**
 * Sections non vides d'un CV, dans l'ordre imposé par la spec (§2/tâche 6) :
 * identité → résumé → expériences → formations → compétences → langues →
 * certifications → projets. Fonction pure, **seule source de vérité** pour
 * les deux rendus (`template.preview.tsx` et `template.pdf.tsx`) : le test de
 * parité (`templates/templates-parity.test.tsx`) s'appuie sur le fait que les deux
 * consomment ce même tableau plutôt que de dupliquer la logique d'omission.
 *
 * L'identité n'est jamais omise (toujours au moins prénom/nom) ; toutes les
 * autres sections le sont dès qu'elles sont vides (résumé : chaîne vide après
 * `trim`, listes : longueur nulle).
 */
export function resumeSections(content: ResumeContent): ResumeSection[] {
  const sections: ResumeSection[] = ['identity'];

  if (content.summary.trim() !== '') sections.push('summary');
  if (content.experiences.length > 0) sections.push('experiences');
  if (content.educations.length > 0) sections.push('educations');
  if (content.skills.length > 0) sections.push('skills');
  if (content.languages.length > 0) sections.push('languages');
  if (content.certifications.length > 0) sections.push('certifications');
  if (content.projects.length > 0) sections.push('projects');

  return sections;
}
