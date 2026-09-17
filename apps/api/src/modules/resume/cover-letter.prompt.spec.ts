import type { ResumeContent } from '@jobtrack/shared';
import { describe, expect, it } from 'vitest';
import { buildLetterDocument, MAX_OFFER_SECTION_CHARS, MAX_PROFILE_SECTION_CHARS } from './cover-letter.prompt';
import type { ResumeJobInput } from './resume-tailoring.prompt';

const MAX_EXPERIENCES = 30;

function baseWithHeavyDescriptions(): ResumeContent {
  const experiences = Array.from({ length: MAX_EXPERIENCES }, (_, index) => ({
    id: `exp-${index}`,
    company: `Entreprise ${index}`,
    role: 'Ingénieur logiciel',
    location: null,
    startDate: '2020-01-01',
    endDate: null,
    isCurrent: false,
    highlights: ['Puce représentative de cette expérience.'],
    sourceDescription: 'x'.repeat(2000),
  }));

  return {
    schemaVersion: 1,
    identity: { firstName: 'Alex', lastName: 'Dupont', title: null },
    summary: 'Résumé du profil.',
    experiences,
    educations: [],
    skills: [],
    languages: [],
    certifications: [],
    projects: [],
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

describe('buildLetterDocument', () => {
  it('30 experiences avec une sourceDescription de 2000 caracteres : les quatre balises restent presentes', () => {
    const document = buildLetterDocument({ base: baseWithHeavyDescriptions(), job, requirements: null, tone: 'PROFESSIONAL' });

    expect(document).toContain('<profil>');
    expect(document).toContain('</profil>');
    expect(document).toContain('<offre>');
    expect(document).toContain('</offre>');
  });

  it('la section <profil> reste sous MAX_PROFILE_SECTION_CHARS meme pour un profil tres charge', () => {
    const document = buildLetterDocument({ base: baseWithHeavyDescriptions(), job, requirements: null, tone: 'SHORT' });
    const profileSection = extractSection(document, '<profil>', '</profil>');

    expect(profileSection.length).toBeLessThanOrEqual(MAX_PROFILE_SECTION_CHARS);
  });

  it("la section <offre> reste sous MAX_OFFER_SECTION_CHARS meme pour une description d_offre demesuree", () => {
    const hugeJob: ResumeJobInput = { ...job, description: 'z'.repeat(100_000) };
    const document = buildLetterDocument({ base: baseWithHeavyDescriptions(), job: hugeJob, requirements: null, tone: 'PERSONAL' });
    const offerSection = extractSection(document, '<offre>', '</offre>');

    expect(offerSection.length).toBeLessThanOrEqual(MAX_OFFER_SECTION_CHARS);
    expect(document).toContain('</offre>');
  });

  it('la ligne de ton precede toujours les balises, jamais bornee avec le profil ou l_offre', () => {
    const document = buildLetterDocument({ base: baseWithHeavyDescriptions(), job, requirements: null, tone: 'SHORT' });

    expect(document.indexOf('Ton demandé')).toBeLessThan(document.indexOf('<profil>'));
  });
});
