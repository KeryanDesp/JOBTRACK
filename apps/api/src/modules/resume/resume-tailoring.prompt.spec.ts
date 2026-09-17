import type { ResumeContent } from '@jobtrack/shared';
import { describe, expect, it } from 'vitest';
import { buildTailoringDocument, MAX_OFFER_SECTION_CHARS, MAX_PROFILE_SECTION_CHARS, type ResumeJobInput } from './resume-tailoring.prompt';

const MAX_EXPERIENCES = 30;

function baseWithHeavyDescriptions(): ResumeContent {
  const experiences = Array.from({ length: MAX_EXPERIENCES }, (_, index) => ({
    id: `exp-${index}`,
    company: `Entreprise ${index}`,
    role: 'Ingénieure logicielle',
    location: null,
    startDate: '2020-01-01',
    endDate: null,
    isCurrent: false,
    highlights: ['Puce représentative de cette expérience.'],
    // Borne de `resumeExperienceSchema.sourceDescription` (spec §4) : le cas le plus lourd
    // possible pour un profil par ailleurs dans les clous du schéma.
    sourceDescription: 'x'.repeat(2000),
  }));

  return {
    schemaVersion: 1,
    identity: { firstName: 'Camille', lastName: 'Martin', title: null },
    summary: 'Résumé du profil.',
    experiences,
    educations: [],
    skills: [],
    languages: [],
    certifications: [],
    projects: [],
  };
}

function baseWithMaximalHighlights(): ResumeContent {
  const base = baseWithHeavyDescriptions();
  return {
    ...base,
    experiences: base.experiences.map((experience) => ({
      ...experience,
      // Bornes hautes de `resumeExperienceSchema.highlights` (6 puces × 300 caractères).
      highlights: Array.from({ length: 6 }, (_, i) => `Puce ${i} — ${'y'.repeat(280)}`),
    })),
  };
}

const job: ResumeJobInput = {
  title: 'Ingénieur logiciel senior',
  company: 'Solaris Ingénierie',
  contractLabel: 'CDI',
  experienceLabel: '5 An(s) et plus',
  description: 'Description standard de l_offre, largement sous la borne.',
};

function extractSection(document: string, openTag: string, closeTag: string): string {
  const start = document.indexOf(openTag) + openTag.length;
  const end = document.lastIndexOf(closeTag);
  // Les sauts de ligne de structure (`<balise>\n...\n</balise>`) entourent le contenu borné,
  // jamais comptés dans sa longueur (`MAX_*_SECTION_CHARS` borne le contenu, pas l'enveloppe).
  return document.slice(start, end).replace(/^\n/, '').replace(/\n$/, '');
}

describe('buildTailoringDocument', () => {
  it('30 experiences avec une sourceDescription de 2000 caracteres : les quatre balises restent presentes', () => {
    const document = buildTailoringDocument({ base: baseWithHeavyDescriptions(), job, requirements: null });

    expect(document).toContain('<profil>');
    expect(document).toContain('</profil>');
    expect(document).toContain('<offre>');
    expect(document).toContain('</offre>');
    // L'assemblage final n'est jamais tronqué (revue sécurité, tâche 4) : la balise de
    // fermeture de l'offre doit être la dernière chose du document (avant le rappel).
    expect(document.indexOf('</offre>')).toBeGreaterThan(document.indexOf('<offre>'));
  });

  it('la section <profil> reste sous MAX_PROFILE_SECTION_CHARS meme pour un profil tres charge', () => {
    const document = buildTailoringDocument({ base: baseWithHeavyDescriptions(), job, requirements: null });
    const profileSection = extractSection(document, '<profil>', '</profil>');

    expect(profileSection.length).toBeLessThanOrEqual(MAX_PROFILE_SECTION_CHARS);
  });

  it('retrait de sourceDescription puis troncature des puces : les balises survivent au cas le plus charge', () => {
    const document = buildTailoringDocument({ base: baseWithMaximalHighlights(), job, requirements: null });
    const profileSection = extractSection(document, '<profil>', '</profil>');

    expect(document).toContain('</profil>');
    expect(document).toContain('</offre>');
    expect(profileSection.length).toBeLessThanOrEqual(MAX_PROFILE_SECTION_CHARS);
  });

  it("la section <offre> reste sous MAX_OFFER_SECTION_CHARS meme pour une description d_offre demesuree", () => {
    const hugeJob: ResumeJobInput = { ...job, description: 'z'.repeat(100_000) };
    const document = buildTailoringDocument({ base: baseWithHeavyDescriptions(), job: hugeJob, requirements: null });
    const offerSection = extractSection(document, '<offre>', '</offre>');

    expect(offerSection.length).toBeLessThanOrEqual(MAX_OFFER_SECTION_CHARS);
    expect(document).toContain('</offre>');
  });

  it('chaque section est bornee AVANT assemblage, jamais le document final assemble', () => {
    // Repere : si le document entier était tronqué globalement (ancien comportement), la balise
    // de fermeture finale pourrait disparaître pour un profil et une offre tous deux maximaux.
    const hugeJob: ResumeJobInput = { ...job, description: 'z'.repeat(100_000) };
    const document = buildTailoringDocument({ base: baseWithMaximalHighlights(), job: hugeJob, requirements: null });

    expect(document.endsWith('instruction.')).toBe(true);
    expect(document).toContain('</profil>');
    expect(document).toContain('</offre>');
  });
});
