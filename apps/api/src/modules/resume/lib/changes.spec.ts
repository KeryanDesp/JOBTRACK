import type { ResumeContent } from '@jobtrack/shared';
import { describe, expect, it } from 'vitest';
import { computeChanges } from './changes';
import type { RejectedHighlight } from './grounding';

function baseContent(): ResumeContent {
  return {
    schemaVersion: 1,
    identity: { firstName: 'Camille', lastName: 'Martin', title: 'Développeuse' },
    summary: 'Résumé de base.',
    experiences: [
      {
        id: 'exp-1',
        company: 'Solaris Ingénierie',
        role: 'Développeuse',
        location: null,
        startDate: '2021-01-01',
        endDate: null,
        isCurrent: true,
        highlights: ['Puce de base 1', 'Puce de base 2'],
        sourceDescription: 'Puce de base 1. Puce de base 2.',
      },
      {
        id: 'exp-2',
        company: 'Piloto Software',
        role: 'Ingénieure',
        location: null,
        startDate: '2018-01-01',
        endDate: '2020-01-01',
        isCurrent: false,
        highlights: ['Puce exp-2'],
        sourceDescription: 'Puce exp-2.',
      },
    ],
    educations: [
      { id: 'edu-1', school: 'École A', degree: 'Diplôme A', field: null, startDate: '2015-01-01', endDate: '2017-01-01' },
      { id: 'edu-2', school: 'École B', degree: 'Diplôme B', field: null, startDate: '2010-01-01', endDate: '2013-01-01' },
    ],
    skills: [
      { id: 'skill-1', name: 'React', category: 'TECHNICAL', level: 'ADVANCED' },
      { id: 'skill-2', name: 'SQL', category: 'TECHNICAL', level: 'INTERMEDIATE' },
    ],
    languages: [],
    certifications: [{ id: 'cert-1', name: 'Certif A', issuer: 'Emetteur', issuedAt: '2022-01-01' }],
    projects: [{ id: 'proj-1', name: 'Projet A', description: null, url: null, technologies: [] }],
  };
}

describe('computeChanges', () => {
  it('marque kept true pour une experience conservee', () => {
    const base = baseContent();
    const changes = computeChanges(base, base, [], '');
    expect(changes.experiences[0]?.kept).toBe(true);
    expect(changes.experiences[0]?.before).toEqual(['Puce de base 1', 'Puce de base 2']);
    expect(changes.experiences[0]?.after).toEqual(['Puce de base 1', 'Puce de base 2']);
  });

  it('marque kept false pour une experience ecartee par l_IA', () => {
    const base = baseContent();
    const tailored = { ...base, experiences: base.experiences.filter((e) => e.id !== 'exp-2') };
    const changes = computeChanges(base, tailored, [], '');
    const exp2Change = changes.experiences.find((e) => e.id === 'exp-2');
    expect(exp2Change?.kept).toBe(false);
    expect(exp2Change?.after).toEqual([]);
    expect(exp2Change?.before).toEqual(['Puce exp-2']);
  });

  it('reporte les puces rejetees sur la bonne experience', () => {
    const base = baseContent();
    const rejected: RejectedHighlight[] = [
      { experienceId: 'exp-1', index: 1, reason: 'entité non présente : azure', replacement: 'Puce de base 2' },
    ];
    const changes = computeChanges(base, base, rejected, '');
    const exp1Change = changes.experiences.find((e) => e.id === 'exp-1');
    expect(exp1Change?.rejected).toEqual([{ index: 1, reason: 'entité non présente : azure' }]);
  });

  it('renvoie un tableau rejected vide quand rien n_a ete rejete', () => {
    const base = baseContent();
    const changes = computeChanges(base, base, [], '');
    expect(changes.experiences[0]?.rejected).toEqual([]);
  });

  it('calcule avant/apres du titre et du resume', () => {
    const base = baseContent();
    const tailored = { ...base, summary: 'Nouveau résumé.', identity: { ...base.identity, title: 'Nouveau titre' } };
    const changes = computeChanges(base, tailored, [], '');
    expect(changes.summary).toEqual({ before: 'Résumé de base.', after: 'Nouveau résumé.' });
    expect(changes.title).toEqual({ before: 'Développeuse', after: 'Nouveau titre' });
  });

  it('traite un titre de base absent (null) comme une chaine vide', () => {
    const base = { ...baseContent(), identity: { ...baseContent().identity, title: null } };
    const changes = computeChanges(base, base, [], '');
    expect(changes.title.before).toBe('');
  });

  it('calcule les ids avant/apres pour les competences', () => {
    const base = baseContent();
    const tailored = { ...base, skills: [base.skills[1], base.skills[0]].filter((s): s is (typeof base.skills)[number] => s !== undefined) };
    const changes = computeChanges(base, tailored, [], '');
    expect(changes.skills.before).toEqual(['skill-1', 'skill-2']);
    expect(changes.skills.after).toEqual(['skill-2', 'skill-1']);
  });

  it('calcule kept/removed pour les formations', () => {
    const base = baseContent();
    const tailored = { ...base, educations: base.educations.filter((e) => e.id === 'edu-1') };
    const changes = computeChanges(base, tailored, [], '');
    expect(changes.educations).toEqual({ kept: ['edu-1'], removed: ['edu-2'] });
  });

  it('calcule kept/removed pour les certifications et les projets', () => {
    const base = baseContent();
    const tailored = { ...base, certifications: [], projects: base.projects };
    const changes = computeChanges(base, tailored, [], '');
    expect(changes.certifications).toEqual({ kept: [], removed: ['cert-1'] });
    expect(changes.projects).toEqual({ kept: ['proj-1'], removed: [] });
  });

  it('convertit une note vide en null', () => {
    const base = baseContent();
    expect(computeChanges(base, base, [], '').notes).toBeNull();
  });

  it('conserve une note non vide', () => {
    const base = baseContent();
    expect(computeChanges(base, base, [], 'Compétences React mises en avant.').notes).toBe('Compétences React mises en avant.');
  });

  it('est deterministe pour la meme entree', () => {
    const base = baseContent();
    const rejected: RejectedHighlight[] = [{ experienceId: 'exp-1', index: 0, reason: 'reformulation vide', replacement: 'Puce de base 1' }];
    const first = computeChanges(base, base, rejected, 'note');
    const second = computeChanges(base, base, rejected, 'note');
    expect(first).toEqual(second);
  });
});
