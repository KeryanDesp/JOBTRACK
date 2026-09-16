import { z as zWireTest } from 'zod/v4';
import { describe, expect, it } from 'vitest';
import {
  cvApplySchema,
  cvExtractionSchema,
  cvExtractionWireSchema,
  educationDraftSchema,
  experienceDraftSchema,
  certificationDraftSchema,
  flexibleDate,
  languageDraftSchema,
  projectDraftSchema,
  skillDraftSchema,
  type CvExtractionWire,
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

  it('complete par des zeros un mois ou jour a un seul chiffre', () => {
    expect(flexibleDate.parse('3/2021')).toBe('2021-03-01');
    expect(flexibleDate.parse('2021-3')).toBe('2021-03-01');
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

  it('refuse une annee peu plausible (avant 1900 ou apres annee courante + 1)', () => {
    expect(flexibleDate.safeParse('1899').success).toBe(false);
    const farFuture = new Date().getFullYear() + 2;
    expect(flexibleDate.safeParse(String(farFuture)).success).toBe(false);
  });

  it('accepte les bornes de plausibilite (1900 et annee courante + 1)', () => {
    expect(flexibleDate.parse('1900')).toBe('1900-01-01');
    const nextYear = new Date().getFullYear() + 1;
    expect(flexibleDate.parse(String(nextYear))).toBe(`${nextYear}-01-01`);
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

  it('traite isCurrent null comme non fourni', () => {
    const parsed = experienceDraftSchema.parse({ ...base, isCurrent: null });
    expect(parsed.isCurrent).toBe(true);
    expect(parsed.endDate).toBeNull();
  });

  it('efface la date de fin quand isCurrent est vrai malgre une date fournie', () => {
    const parsed = experienceDraftSchema.parse({ ...base, isCurrent: true, endDate: '2022' });
    expect(parsed.endDate).toBeNull();
  });

  it('accepte une localisation ou une description nulle', () => {
    const parsed = experienceDraftSchema.parse({ ...base, isCurrent: true, location: null, description: null });
    expect(parsed.location).toBeNull();
    expect(parsed.description).toBeNull();
  });

  it('signale une date de debut manquante', () => {
    const result = experienceDraftSchema.safeParse({ company: 'Acme', role: 'Dev' });
    expect(result.success).toBe(false);
    if (!result.success) expect(result.error.issues[0]?.message).toBe('Date de début manquante.');
  });

  it('signale une date de fin anterieure a la date de debut', () => {
    const result = experienceDraftSchema.safeParse({ ...base, startDate: '2022', endDate: '2021' });
    expect(result.success).toBe(false);
    if (!result.success) expect(result.error.issues[0]?.path).toEqual(['endDate']);
  });
});

describe('educationDraftSchema', () => {
  it('signale une date de fin anterieure a la date de debut', () => {
    const result = educationDraftSchema.safeParse({
      school: 'Universite',
      degree: 'Master',
      startDate: '2022',
      endDate: '2021',
    });
    expect(result.success).toBe(false);
    if (!result.success) expect(result.error.issues[0]?.path).toEqual(['endDate']);
  });
});

describe('certificationDraftSchema', () => {
  it('signale une date d_expiration anterieure a la date d_obtention', () => {
    const result = certificationDraftSchema.safeParse({
      name: 'Cert',
      issuer: 'Editeur',
      issuedAt: '2022',
      expiresAt: '2021',
    });
    expect(result.success).toBe(false);
    if (!result.success) expect(result.error.issues[0]?.path).toEqual(['expiresAt']);
  });

  it('accepte credentialUrl nul', () => {
    expect(
      certificationDraftSchema.parse({ name: 'Cert', issuer: 'Editeur', issuedAt: '2022', credentialUrl: null })
        .credentialUrl,
    ).toBeNull();
  });
});

describe('skillDraftSchema', () => {
  it('reconnait les synonymes francais de categorie', () => {
    expect(skillDraftSchema.parse({ name: 'Excel', category: 'outil' }).category).toBe('TOOL');
    expect(skillDraftSchema.parse({ name: 'Ecoute', category: 'humaine' }).category).toBe('SOFT');
  });

  it('retombe sur TECHNICAL pour une categorie inconnue ou nulle', () => {
    expect(skillDraftSchema.parse({ name: 'X', category: 'mystere' }).category).toBe('TECHNICAL');
    expect(skillDraftSchema.parse({ name: 'X', category: null }).category).toBe('TECHNICAL');
  });

  it('reconnait les synonymes francais de niveau', () => {
    expect(skillDraftSchema.parse({ name: 'X', level: 'debutant' }).level).toBe('BEGINNER');
    expect(skillDraftSchema.parse({ name: 'X', level: 'avance' }).level).toBe('ADVANCED');
  });

  it('retombe sur INTERMEDIATE pour un niveau inconnu, nul ou absent', () => {
    expect(skillDraftSchema.parse({ name: 'X', level: 'mystere' }).level).toBe('INTERMEDIATE');
    expect(skillDraftSchema.parse({ name: 'X', level: null }).level).toBe('INTERMEDIATE');
    expect(skillDraftSchema.parse({ name: 'X' }).level).toBe('INTERMEDIATE');
  });
});

describe('languageDraftSchema', () => {
  it('reconnait maternelle et natif comme NATIVE', () => {
    expect(languageDraftSchema.parse({ name: 'Francais', level: 'maternelle' }).level).toBe('NATIVE');
    expect(languageDraftSchema.parse({ name: 'Anglais', level: 'natif' }).level).toBe('NATIVE');
  });

  it('retombe sur B2 pour un niveau inconnu, nul ou absent', () => {
    expect(languageDraftSchema.parse({ name: 'Espagnol', level: 'mystere' }).level).toBe('B2');
    expect(languageDraftSchema.parse({ name: 'Espagnol', level: null }).level).toBe('B2');
    expect(languageDraftSchema.parse({ name: 'Espagnol' }).level).toBe('B2');
  });
});

describe('projectDraftSchema (draftUrl)', () => {
  it('neutralise un protocole non http(s) en null plutot que d_echouer', () => {
    expect(projectDraftSchema.parse({ name: 'X', url: 'javascript:alert(1)' }).url).toBeNull();
    expect(projectDraftSchema.parse({ name: 'X', url: 'data:text/html,x' }).url).toBeNull();
  });

  it('conserve une url http(s) valide', () => {
    expect(projectDraftSchema.parse({ name: 'X', url: 'https://x.y' }).url).toBe('https://x.y');
  });

  it('neutralise une url trop longue (plus de 2000 caracteres)', () => {
    const url = `https://x.y/${'a'.repeat(2000)}`;
    expect(projectDraftSchema.parse({ name: 'X', url }).url).toBeNull();
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

  it('tronque le nombre d_experiences a 50 plutot que d_echouer', () => {
    const experiences = Array.from({ length: 51 }, () => ({ company: 'A', role: 'B', startDate: '2020' }));
    const parsed = cvExtractionSchema.parse({ experiences });
    expect(parsed.experiences).toHaveLength(50);
  });

  it('tronque le nombre de competences a 100 plutot que d_echouer', () => {
    const skills = Array.from({ length: 101 }, (_, i) => ({ name: `Skill${i}` }));
    const parsed = cvExtractionSchema.parse({ skills });
    expect(parsed.skills).toHaveLength(100);
  });

  it('ecarte une experience invalide au milieu de deux experiences valides', () => {
    const experiences = [
      { company: 'Acme', role: 'Dev', startDate: '2020' },
      { company: 'Beta', role: 'Stagiaire', startDate: '2022', endDate: '2021' }, // fin avant debut : invalide
      { company: 'Gamma', role: 'Lead', startDate: '2023' },
    ];
    const parsed = cvExtractionSchema.parse({ experiences });
    expect(parsed.experiences).toHaveLength(2);
    expect(parsed.experiences.map((experience) => experience.company)).toEqual(['Acme', 'Gamma']);
  });

  it('tronque un resume trop long plutot que d_echouer', () => {
    const summary = 'a'.repeat(2500);
    const parsed = cvExtractionSchema.parse({ identity: { summary } });
    expect(parsed.identity.summary).toHaveLength(2000);
  });

  it('coupe les technologies d_un projet a 20 elements sans faire echouer le parsing', () => {
    const technologies = Array.from({ length: 25 }, (_, i) => `tech-${i}`);
    const parsed = cvExtractionSchema.parse({
      projects: [{ name: 'Projet', technologies }],
    });
    expect(parsed.projects[0]?.technologies).toHaveLength(20);
  });

  it('ecarte les postes/lieux vides des preferences plutot que d_echouer', () => {
    const parsed = cvExtractionSchema.parse({
      preferences: { desiredRoles: ['Dev', '', '   '], locations: ['Paris', ''] },
    });
    expect(parsed.preferences.desiredRoles).toEqual(['Dev']);
    expect(parsed.preferences.locations).toEqual(['Paris']);
  });
});

describe('cvExtractionWireSchema', () => {
  const wireSample: CvExtractionWire = {
    identity: {
      firstName: 'Camille',
      lastName: 'Demo',
      phone: null,
      city: 'Paris',
      country: null,
      title: 'Developpeuse',
      summary: null,
    },
    experiences: [
      {
        company: 'Acme',
        role: 'Dev',
        location: null,
        startDate: '2021',
        endDate: null,
        isCurrent: true,
        description: null,
      },
      {
        company: 'Beta',
        role: 'Stagiaire',
        location: 'Lyon',
        startDate: '2019',
        endDate: '2020',
        isCurrent: null,
        description: null,
      },
    ],
    educations: [],
    skills: [{ name: 'TypeScript', category: null, level: null }],
    languages: [{ name: 'Anglais', level: null }],
    certifications: [],
    projects: [{ name: 'Projet', description: null, url: null, technologies: [] }],
    preferences: { desiredRoles: [], locations: [] },
  };

  it('valide un exemple realiste au format fil (toutes les cles requises, nullable)', () => {
    expect(cvExtractionWireSchema.safeParse(wireSample).success).toBe(true);
  });

  it('cvExtractionSchema normalise directement une sortie au format fil', () => {
    expect(() => cvExtractionSchema.parse(wireSample)).not.toThrow();
    const parsed = cvExtractionSchema.parse(wireSample);
    expect(parsed.experiences[1]?.isCurrent).toBe(false);
  });

  it('genere un json schema portant les bornes maxLength (zod v4 toJSONSchema)', () => {
    const jsonSchema = zWireTest.toJSONSchema(cvExtractionWireSchema);
    expect(JSON.stringify(jsonSchema)).toContain('maxLength');
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

  it('pose des defauts vides sur toutes les cles de premier niveau', () => {
    const result = cvApplySchema.safeParse({});
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.identity).toEqual({});
      expect(result.data.experiences).toEqual([]);
      expect(result.data.preferences).toEqual({});
    }
  });
});

describe('aller-retour brouillon -> application', () => {
  it('cvApplySchema accepte chaque element produit par cvExtractionSchema sur un brouillon realiste', () => {
    const extraction = cvExtractionSchema.parse({
      identity: { firstName: 'Camille' },
      experiences: [{ company: 'Acme', role: 'Dev', location: null, startDate: '2021', endDate: null }],
      educations: [{ school: 'Universite', degree: 'Master', startDate: '2018', endDate: '2020' }],
      skills: [{ name: 'TypeScript', category: 'technique', level: 'avance' }],
      languages: [{ name: 'Anglais', level: 'courant' }],
      certifications: [{ name: 'Cert', issuer: 'Editeur', issuedAt: '2022', credentialUrl: null }],
      projects: [{ name: 'Projet', description: null, url: null, technologies: ['ts', ''] }],
    });

    const apply = cvApplySchema.safeParse({
      identity: {},
      experiences: extraction.experiences.map((item) => ({ selected: true, item })),
      educations: extraction.educations.map((item) => ({ selected: true, item })),
      skills: extraction.skills.map((item) => ({ selected: true, item })),
      languages: extraction.languages.map((item) => ({ selected: true, item })),
      certifications: extraction.certifications.map((item) => ({ selected: true, item })),
      projects: extraction.projects.map((item) => ({ selected: true, item })),
      preferences: {},
    });

    expect(apply.success).toBe(true);
  });
});
