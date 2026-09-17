import { resumeChangesSchema, type ResumeChanges, type ResumeContent } from '@jobtrack/shared';
import type { RejectedHighlight } from './grounding';

/**
 * Diff avant/après par section (spec §4/§42), calculé côté serveur entre le
 * document de base et le document ancré (`groundTailoring`) — pur, testé
 * isolément, conservé sur la version `AI` pour que l'utilisateur voie chaque
 * puce avec sa source et rétablisse un élément écarté.
 */

function groupRejectedByExperience(rejected: readonly RejectedHighlight[]): Map<string, RejectedHighlight[]> {
  const map = new Map<string, RejectedHighlight[]>();
  for (const item of rejected) {
    const list = map.get(item.experienceId) ?? [];
    list.push(item);
    map.set(item.experienceId, list);
  }
  return map;
}

/** Identifiants de `baseItems` répartis entre conservés et retirés dans `tailoredItems` (même id). */
function keptRemoved<T extends { id: string }>(
  baseItems: readonly T[],
  tailoredItems: readonly T[],
): { kept: string[]; removed: string[] } {
  const tailoredIds = new Set(tailoredItems.map((item) => item.id));
  const kept: string[] = [];
  const removed: string[] = [];
  for (const item of baseItems) {
    (tailoredIds.has(item.id) ? kept : removed).push(item.id);
  }
  return { kept, removed };
}

/**
 * Calcule `ResumeChanges` (spec §4) entre le document de base et le document
 * ancré : toutes les expériences de base apparaissent (`kept: false` pour
 * celles écartées par l'IA, rétablissables côté utilisateur), les puces
 * rejetées par l'ancrage (`rejected`, calculées par `groundTailoring`) sont
 * réparties par expérience, `notes` vide devient `null` (aucune note à
 * afficher).
 */
export function computeChanges(
  base: ResumeContent,
  tailored: ResumeContent,
  rejected: readonly RejectedHighlight[],
  notes: string,
): ResumeChanges {
  const tailoredExperienceIds = new Set(tailored.experiences.map((experience) => experience.id));
  const tailoredExperienceById = new Map(tailored.experiences.map((experience) => [experience.id, experience] as const));
  const rejectedByExperience = groupRejectedByExperience(rejected);

  const experiences = base.experiences.map((baseExperience) => {
    const kept = tailoredExperienceIds.has(baseExperience.id);
    const after = kept ? (tailoredExperienceById.get(baseExperience.id)?.highlights ?? []) : [];
    const experienceRejections = rejectedByExperience.get(baseExperience.id) ?? [];

    return {
      id: baseExperience.id,
      before: baseExperience.highlights,
      after,
      kept,
      rejected: experienceRejections.map((item) => ({ index: item.index, reason: item.reason })),
    };
  });

  return resumeChangesSchema.parse({
    title: { before: base.identity.title ?? '', after: tailored.identity.title ?? '' },
    summary: { before: base.summary, after: tailored.summary },
    experiences,
    skills: {
      before: base.skills.map((skill) => skill.id),
      after: tailored.skills.map((skill) => skill.id),
    },
    educations: keptRemoved(base.educations, tailored.educations),
    certifications: keptRemoved(base.certifications, tailored.certifications),
    projects: keptRemoved(base.projects, tailored.projects),
    notes: notes === '' ? null : notes,
  });
}
