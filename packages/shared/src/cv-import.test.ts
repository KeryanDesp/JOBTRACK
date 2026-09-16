import { describe, expect, it } from 'vitest';
import {
  cvApplySchema,
  cvExtractionSchema,
  experienceDraftSchema,
  flexibleDate,
  languageDraftSchema,
  skillDraftSchema,
} from './cv-import';

describe('flexibleDate', () => {
  it('normalise une annee seule au premier janvier', () => {
    expect(flexibleDate.parse('2021')).toBe('2021-01-01');
  });

  it('normalise annee-mois au premier jour du mois', () => {
    expect(flexibleDate.parse('2021-03')).toBe('2021-03-01');
  });

  it('normalise MM/AAAA au premier jour du mois', () => {
    expect(flexibleDate.parse('03/2021')).toBe('2021-03-01');
  });

  it('normalise JJ/MM/AAAA', () => {
    expect(flexibleDate.parse('15/03/2021')).toBe('2021-03-15');
  });

  it('accepte une date complete AAAA-MM-JJ et des espaces superflus', () => {
    expect(flexibleDate.parse('2021-03-15')).toBe('2021-03-15');
    expect(flexibleDate.parse('  2021-03-15  ')).toBe('2021-03-15');
  });

  it('transforme chaine vide, null et undefined en null', () => {
    expect(flexibleDate.parse('')).toBeNull();
    expect(flexibleDate.parse(null)).toBeNull();
    expect(flexibleDate.parse(undefined)).toBeNull();
  });

  it('refuse un mois invalide avec le message dedie', () => {
    const result = flexibleDate.safeParse('2021-13');
    expect(result.success).toBe(false);
    if (!result.success) expect(result.error.issues[0]?.message).toBe('Date non reconnue.');
  });

  it('refuse une date calendaire impossible (31 avril)', () => {
    expect(flexibleDate.safeParse('31/04/2021').success).toBe(false);
  });

  it('refuse un format non reconnu', () => {
    expect(flexibleDate.safeParse('hier').success).toBe(false);
  });
});

describe('experienceDraftSchema', () => {
  const base = { company: 'Acme', role: 'Dev', startDate: '2021' };

  it('deduit isCurrent quand la date de fin est absente et non fournie', () => {
    const parsed = experienceDraftSchema.parse(base);
    expect(parsed.isCurrent).toBe(true);
    expect(parsed.endDate).toBeNull();
  });

  it('respecte isCurrent explicitement a false sans date de fin (reste null et false)', () => {
    const parsed = experienceDraftSchema.parse({ ...base, isCurrent: false });
    expect(parsed.isCurrent).toBe(false);
    expect(parsed.endDate).toBeNull();
  });

  it('efface la date de fin quand isCurrent est vrai malgre une date fournie', () => {
    const parsed = experienceDraftSchema.parse({ ...base, isCurrent: true, endDate: '2022' });
    expect(parsed.endDate).toBeNull();
  });

  it('signale une date de debut manquante', () => {
    const result = experienceDraftSchema.safeParse({ company: 'Acme', role: 'Dev' });
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.issues.some((issue) => issue.message === 'Date de debut manquante.')).toBe(true);
    }
  });

  it('signale une date de fin anterieure a la date de debut', () => {
    const result = experienceDraftSchema.safeParse({ ...base, startDate: '2022', endDate: '2021' });
    expect(result.success).toBe(false);
    if (!result.success) expect(result.error.issues[0]?.path).toEqual(['endDate']);
  });
});

describe('skillDraftSchema', () => {
  it('reconnait les synonymes francais de categorie', () => {
    expect(skillDraftSchema.parse({ name: 'Excel', category: 'outil' }).category).toBe('TOOL');
    expect(skillDraftSchema.parse({ name: 'Ecoute', category: 'humaine' }).category).toBe('SOFT');
  });

  it('retombe sur TECHNICAL pour une categorie inconnue', () => {
    expect(skillDraftSchema.parse({ name: 'X', category: 'mystere' }).category).toBe('TECHNICAL');
  });

  it('reconnait les synonymes francais de niveau', () => {
    expect(skillDraftSchema.parse({ name: 'X', level: 'debutant' }).level).toBe('BEGINNER');
    expect(skillDraftSchema.parse({ name: 'X', level: 'avance' }).level).toBe('ADVANCED');
  });

  it('retombe sur INTERMEDIATE pour un niveau inconnu ou absent', () => {
    expect(skillDraftSchema.parse({ name: 'X', level: 'mystere' }).level).toBe('INTERMEDIATE');
    expect(skillDraftSchema.parse({ name: 'X' }).level).toBe('INTERMEDIATE');
  });
});

describe('languageDraftSchema', () => {
  it('reconnait maternelle et natif comme NATIVE', () => {
    expect(languageDraftSchema.parse({ name: 'Francais', level: 'maternelle' }).level).toBe('NATIVE');
    expect(languageDraftSchema.parse({ name: 'Anglais', level: 'natif' }).level).toBe('NATIVE');
  });

  it('retombe sur B2 pour un niveau inconnu ou absent', () => {
    expect(languageDraftSchema.parse({ name: 'Espagnol', level: 'mystere' }).level).toBe('B2');
    expect(languageDraftSchema.parse({ name: 'Espagnol' }).level).toBe('B2');
  });
});

describe('cvExtractionSchema', () => {
  it('accepte une extraction vide et pose tous les defauts', () => {
    const parsed = cvExtractionSchema.parse({});
    expect(parsed.identity).toEqual({});
    expect(parsed.experiences).toEqual([]);
    expect(parsed.skills).toEqual([]);
    expect(parsed.preferences).toEqual({ desiredRoles: [], locations: [] });
  });

  it('limite le nombre d_experiences a 50', () => {
    const experiences = Array.from({ length: 51 }, () => ({ company: 'A', role: 'B', startDate: '2020' }));
    expect(cvExtractionSchema.safeParse({ experiences }).success).toBe(false);
  });

  it('limite le nombre de competences a 100', () => {
    const skills = Array.from({ length: 101 }, (_, i) => ({ name: `Skill${i}` }));
    expect(cvExtractionSchema.safeParse({ skills }).success).toBe(false);
  });

  it('coupe les technologies d_un projet a 20 elements sans faire echouer le parsing', () => {
    const technologies = Array.from({ length: 25 }, (_, i) => `tech-${i}`);
    const parsed = cvExtractionSchema.parse({
      projects: [{ name: 'Projet', technologies }],
    });
    expect(parsed.projects[0]?.technologies).toHaveLength(20);
  });
});

describe('cvApplySchema', () => {
  const validExperience = {
    selected: true,
    item: { company: 'Acme', role: 'Dev', startDate: '2021-01-01', isCurrent: true },
  };

  it('accepte un element selectionnable valide', () => {
    const result = cvApplySchema.safeParse({
      identity: { firstName: 'Alex' },
      experiences: [validExperience],
      educations: [],
      skills: [],
      languages: [],
      certifications: [],
      projects: [],
      preferences: {},
    });
    expect(result.success).toBe(true);
  });

  it('refuse un element invalide (poste sans date de fin ni isCurrent)', () => {
    const result = cvApplySchema.safeParse({
      identity: {},
      experiences: [
        { selected: true, item: { company: 'Acme', role: 'Dev', startDate: '2021-01-01' } },
      ],
      educations: [],
      skills: [],
      languages: [],
      certifications: [],
      projects: [],
      preferences: {},
    });
    expect(result.success).toBe(false);
  });
});
