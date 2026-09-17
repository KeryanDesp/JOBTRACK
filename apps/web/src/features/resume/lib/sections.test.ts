import type { ResumeContent } from '@jobtrack/shared';
import { describe, expect, it } from 'vitest';
import { resumeSections } from './sections';

function makeFullResumeContent(): ResumeContent {
  return {
    schemaVersion: 1,
    identity: { firstName: 'Alice', lastName: 'Martin', title: 'Développeuse', email: 'alice@example.com' },
    summary: 'Développeuse experimentee.',
    experiences: [
      {
        id: 'exp-1',
        company: 'Piloto Software',
        role: 'Développeuse React',
        location: 'Metz',
        startDate: '2022-03-01',
        endDate: null,
        isCurrent: true,
        highlights: ['A construit une interface.'],
        sourceDescription: null,
      },
    ],
    educations: [{ id: 'edu-1', school: 'Universite', degree: 'Master', field: 'Informatique', startDate: '2018-09-01', endDate: '2020-06-01' }],
    skills: [{ id: 'skill-1', name: 'React', category: 'TECHNICAL', level: 'ADVANCED' }],
    languages: [{ id: 'lang-1', name: 'Anglais', level: 'B2' }],
    certifications: [{ id: 'cert-1', name: 'AWS', issuer: 'Amazon', issuedAt: '2021-01-01' }],
    projects: [{ id: 'proj-1', name: 'Projet perso', description: null, url: null, technologies: ['TypeScript'] }],
  };
}

describe('resumeSections', () => {
  it('renvoie toutes les sections dans l ordre impose pour un document complet', () => {
    expect(resumeSections(makeFullResumeContent())).toEqual([
      'identity',
      'summary',
      'experiences',
      'educations',
      'skills',
      'languages',
      'certifications',
      'projects',
    ]);
  });

  it('omet une section vide (liste vide)', () => {
    const content = { ...makeFullResumeContent(), projects: [] };
    expect(resumeSections(content)).not.toContain('projects');
  });

  it('omet le resume quand il est une chaine vide apres trim', () => {
    const content = { ...makeFullResumeContent(), summary: '   ' };
    expect(resumeSections(content)).not.toContain('summary');
  });

  it('ne renvoie que l identite pour un document totalement vide', () => {
    const content: ResumeContent = {
      schemaVersion: 1,
      identity: { firstName: 'Bob', lastName: 'Durand', title: null },
      summary: '',
      experiences: [],
      educations: [],
      skills: [],
      languages: [],
      certifications: [],
      projects: [],
    };
    expect(resumeSections(content)).toEqual(['identity']);
  });
});
