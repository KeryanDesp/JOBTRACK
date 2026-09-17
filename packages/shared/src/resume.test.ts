import { describe, expect, it } from 'vitest';
import {
  COVER_LETTER_MAX_CHARS,
  COVER_LETTER_TONES,
  RESUME_SECTION_LABELS,
  RESUME_TEMPLATES,
  RESUME_VERSION_SOURCES,
  buildBaseResume,
  coverLetterContentSchema,
  coverLetterWireSchema,
  createCoverLetterSchema,
  createTailoredResumeSchema,
  resumeChangesSchema,
  resumeContentSchema,
  resumeFileName,
  resumeTailoringSchema,
  resumeTailoringWireSchema,
  splitDescriptionIntoHighlights,
  updateCoverLetterSchema,
  updateResumeSchema,
  updateResumeTemplateSchema,
  type ResumeSourceProfile,
} from './resume';

// ---------------------------------------------------------------------------
// splitDescriptionIntoHighlights / buildBaseResume
// ---------------------------------------------------------------------------

function baseProfile(overrides: Partial<ResumeSourceProfile> = {}): ResumeSourceProfile {
  return {
    firstName: 'Elodie',
    lastName: 'Muller',
    title: 'Developpeuse',
    summary: 'Resume court.',
    email: 'elodie@example.com',
    phone: '0600000000',
    city: 'Paris',
    country: 'France',
    experiences: [],
    educations: [],
    skills: [],
    languages: [],
    certifications: [],
    projects: [],
    ...overrides,
  };
}

describe('splitDescriptionIntoHighlights', () => {
  it('reconnait les puces prefixees par -, *, • ou –', () => {
    const description = '- Premiere puce\n* Deuxieme puce\n• Troisieme puce\n– Quatrieme puce';
    expect(splitDescriptionIntoHighlights(description)).toEqual([
      'Premiere puce',
      'Deuxieme puce',
      'Troisieme puce',
      'Quatrieme puce',
    ]);
  });

  it('se replie sur un decoupage en phrases quand aucune ligne n_est une puce', () => {
    const description = 'A dirige une equipe de 5 personnes. A livre le projet en 3 mois.';
    expect(splitDescriptionIntoHighlights(description)).toEqual([
      'A dirige une equipe de 5 personnes',
      'A livre le projet en 3 mois',
    ]);
  });

  it('tronque a 6 puces au plus', () => {
    const description = Array.from({ length: 10 }, (_, i) => `- Puce ${i}`).join('\n');
    expect(splitDescriptionIntoHighlights(description)).toHaveLength(6);
  });

  it('tronque chaque puce a 300 caracteres', () => {
    const description = `- ${'x'.repeat(400)}`;
    const result = splitDescriptionIntoHighlights(description);
    expect(result[0]).toHaveLength(300);
  });

  it('retourne un tableau vide pour null ou une chaine vide', () => {
    expect(splitDescriptionIntoHighlights(null)).toEqual([]);
    expect(splitDescriptionIntoHighlights('')).toEqual([]);
    expect(splitDescriptionIntoHighlights('   ')).toEqual([]);
  });

  it('reconnait une numerotation (1. ou 2)) comme une puce', () => {
    const description = '1. Premier point\n2) Deuxieme point';
    expect(splitDescriptionIntoHighlights(description)).toEqual(['Premier point', 'Deuxieme point']);
  });

  it('garde chaque ligne comme puce distincte meme sans prefixe de puce (plusieurs lignes)', () => {
    const description = 'Premiere realisation\nDeuxieme realisation';
    expect(splitDescriptionIntoHighlights(description)).toEqual(['Premiere realisation', 'Deuxieme realisation']);
  });

  it('ne decoupe pas en phrases une description multi-lignes non prefixee (ne fusionne pas les lignes)', () => {
    const description = 'A dirige une equipe\nA livre le projet';
    const result = splitDescriptionIntoHighlights(description);
    expect(result).toEqual(['A dirige une equipe', 'A livre le projet']);
    expect(result).not.toEqual(['A dirige une equipe A livre le projet']);
  });

  it('ne coupe pas apres une abreviation suivie d_un point (M., etc.)', () => {
    const description = 'A rencontre M. Dupont. A signe le contrat, etc. A livre le projet.';
    expect(splitDescriptionIntoHighlights(description)).toEqual([
      'A rencontre M. Dupont',
      'A signe le contrat, etc. A livre le projet',
    ]);
  });

  it('ne coupe pas un nombre decimal (3.5) meme suivi d_un chiffre', () => {
    const description = 'A code depuis 3.5 ans avec Python.';
    expect(splitDescriptionIntoHighlights(description)).toEqual(['A code depuis 3.5 ans avec Python']);
  });

  it('coupe quand le mot suivant le point commence par un chiffre', () => {
    const description = 'Premier lot livre. 2 clients signes.';
    expect(splitDescriptionIntoHighlights(description)).toEqual(['Premier lot livre', '2 clients signes']);
  });
});

describe('buildBaseResume', () => {
  it('construit un document avec schemaVersion 1 et les coordonnees quand includeContact est omis', () => {
    const result = buildBaseResume(baseProfile());
    expect(result.schemaVersion).toBe(1);
    expect(result.identity.email).toBe('elodie@example.com');
    expect(result.identity.phone).toBe('0600000000');
    expect(result.identity.city).toBe('Paris');
    expect(result.identity.country).toBe('France');
  });

  it('omet email et telephone quand includeContact est false, mais garde ville et pays', () => {
    const result = buildBaseResume(baseProfile(), { includeContact: false });
    expect(result.identity).not.toHaveProperty('email');
    expect(result.identity).not.toHaveProperty('phone');
    expect(result.identity.city).toBe('Paris');
    expect(result.identity.country).toBe('France');
    expect(result.identity.firstName).toBe('Elodie');
  });

  it('omet un champ de coordonnees deja absent du profil (null) meme avec includeContact', () => {
    const result = buildBaseResume(baseProfile({ phone: null, city: null, country: null }));
    expect(result.identity).not.toHaveProperty('phone');
    expect(result.identity).not.toHaveProperty('city');
    expect(result.identity).not.toHaveProperty('country');
  });

  it('decoupe la description d_une experience en highlights et garde sourceDescription', () => {
    const result = buildBaseResume(
      baseProfile({
        experiences: [
          {
            id: 'exp1',
            sortOrder: 0,
            company: 'Acme',
            role: 'Dev',
            location: null,
            startDate: '2020-01-01',
            endDate: '2021-01-01',
            isCurrent: false,
            description: '- A fait X\n- A fait Y',
          },
        ],
      }),
    );
    expect(result.experiences[0]?.highlights).toEqual(['A fait X', 'A fait Y']);
    expect(result.experiences[0]?.sourceDescription).toBe('- A fait X\n- A fait Y');
  });

  it('ordonne les experiences avec le poste actuel en premier', () => {
    const result = buildBaseResume(
      baseProfile({
        experiences: [
          {
            id: 'past',
            sortOrder: 0,
            company: 'A',
            role: 'Dev',
            location: null,
            startDate: '2018-01-01',
            endDate: '2019-01-01',
            isCurrent: false,
            description: null,
          },
          {
            id: 'current',
            sortOrder: 1,
            company: 'B',
            role: 'Dev',
            location: null,
            startDate: '2022-01-01',
            endDate: null,
            isCurrent: true,
            description: null,
          },
        ],
      }),
    );
    expect(result.experiences.map((e) => e.id)).toEqual(['current', 'past']);
  });

  it('ordonne les experiences non courantes par date de debut decroissante', () => {
    const result = buildBaseResume(
      baseProfile({
        experiences: [
          {
            id: 'older',
            sortOrder: 0,
            company: 'A',
            role: 'Dev',
            location: null,
            startDate: '2015-01-01',
            endDate: '2016-01-01',
            isCurrent: false,
            description: null,
          },
          {
            id: 'recent',
            sortOrder: 1,
            company: 'B',
            role: 'Dev',
            location: null,
            startDate: '2020-01-01',
            endDate: '2021-01-01',
            isCurrent: false,
            description: null,
          },
        ],
      }),
    );
    expect(result.experiences.map((e) => e.id)).toEqual(['recent', 'older']);
  });

  it('ordonne skills, languages et projects par sortOrder', () => {
    const result = buildBaseResume(
      baseProfile({
        skills: [
          { id: 's2', sortOrder: 1, name: 'React', category: 'TECHNICAL', level: 'ADVANCED' },
          { id: 's1', sortOrder: 0, name: 'TypeScript', category: 'TECHNICAL', level: 'EXPERT' },
        ],
      }),
    );
    expect(result.skills.map((s) => s.id)).toEqual(['s1', 's2']);
  });

  it('tronque la description d_un projet a 400 caracteres', () => {
    const result = buildBaseResume(
      baseProfile({
        projects: [
          {
            id: 'p1',
            sortOrder: 0,
            name: 'Projet',
            description: 'x'.repeat(500),
            url: null,
            technologies: [],
          },
        ],
      }),
    );
    expect(result.projects[0]?.description).toHaveLength(400);
  });

  it('produit un document valide par resumeContentSchema', () => {
    const result = buildBaseResume(baseProfile());
    expect(resumeContentSchema.safeParse(result).success).toBe(true);
  });

  it('ordonne les formations avec celle en cours (sans endDate) en premier', () => {
    const result = buildBaseResume(
      baseProfile({
        educations: [
          {
            id: 'finie',
            sortOrder: 0,
            school: 'Universite A',
            degree: 'Licence',
            field: null,
            startDate: '2015-01-01',
            endDate: '2018-01-01',
          },
          {
            id: 'en-cours',
            sortOrder: 1,
            school: 'Universite B',
            degree: 'Master',
            field: null,
            startDate: '2022-01-01',
            endDate: null,
          },
        ],
      }),
    );
    expect(result.educations.map((e) => e.id)).toEqual(['en-cours', 'finie']);
  });

  it('ordonne les certifications par date d_obtention decroissante', () => {
    const result = buildBaseResume(
      baseProfile({
        certifications: [
          { id: 'ancienne', sortOrder: 0, name: 'Cert A', issuer: 'X', issuedAt: '2018-01-01' },
          { id: 'recente', sortOrder: 1, name: 'Cert B', issuer: 'Y', issuedAt: '2023-01-01' },
        ],
      }),
    );
    expect(result.certifications.map((c) => c.id)).toEqual(['recente', 'ancienne']);
  });

  it('reste deterministe : deux appels sur le meme profil produisent le meme document', () => {
    const profile = baseProfile({
      experiences: [
        {
          id: 'e1',
          sortOrder: 0,
          company: 'Acme',
          role: 'Dev',
          location: null,
          startDate: '2020-01-01',
          endDate: null,
          isCurrent: true,
          description: '- A fait X',
        },
      ],
      skills: [{ id: 's1', sortOrder: 0, name: 'React', category: 'TECHNICAL', level: 'ADVANCED' }],
    });
    expect(buildBaseResume(profile)).toEqual(buildBaseResume(profile));
  });

  it('reste valide par resumeContentSchema meme pour un profil qui deborde toutes les bornes', () => {
    const experiences = Array.from({ length: 31 }, (_, i) => ({
      id: `exp${i}`,
      sortOrder: i,
      company: `Entreprise ${i}`,
      role: 'Dev',
      location: null,
      startDate: '2020-01-01',
      endDate: '2021-01-01',
      isCurrent: false,
      description: null,
    }));
    const skills = Array.from({ length: 61 }, (_, i) => ({
      id: `skill${i}`,
      sortOrder: i,
      name: `Competence ${i}`,
      category: 'TECHNICAL' as const,
      level: 'ADVANCED' as const,
    }));
    const profile = baseProfile({ experiences, skills, summary: 'x'.repeat(2000) });

    const result = buildBaseResume(profile);

    expect(result.experiences).toHaveLength(30);
    expect(result.skills).toHaveLength(60);
    expect(result.summary).toHaveLength(1200);
    expect(resumeContentSchema.safeParse(result).success).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// resumeContentSchema — strictness et bornes
// ---------------------------------------------------------------------------

function validContent() {
  return {
    schemaVersion: 1,
    identity: { firstName: 'Elodie', lastName: 'Muller', title: null, email: 'e@example.com' },
    summary: 'Resume',
    experiences: [],
    educations: [],
    skills: [],
    languages: [],
    certifications: [],
    projects: [],
  };
}

describe('resumeContentSchema', () => {
  it('accepte un document minimal valide', () => {
    expect(resumeContentSchema.safeParse(validContent()).success).toBe(true);
  });

  it('refuse une cle inconnue (strict)', () => {
    const result = resumeContentSchema.safeParse({ ...validContent(), extra: 'nope' });
    expect(result.success).toBe(false);
  });

  it('refuse un schemaVersion different de 1', () => {
    const result = resumeContentSchema.safeParse({ ...validContent(), schemaVersion: 2 });
    expect(result.success).toBe(false);
  });

  it('refuse plus de 6 highlights sur une experience', () => {
    const content = {
      ...validContent(),
      experiences: [
        {
          id: 'e1',
          company: 'Acme',
          role: 'Dev',
          location: null,
          startDate: '2020-01-01',
          endDate: null,
          isCurrent: true,
          highlights: Array.from({ length: 7 }, (_, i) => `Puce ${i}`),
          sourceDescription: null,
        },
      ],
    };
    expect(resumeContentSchema.safeParse(content).success).toBe(false);
  });

  it('refuse une url de lien non http(s)', () => {
    const content = {
      ...validContent(),
      identity: { ...validContent().identity, links: [{ label: 'Portfolio', url: 'javascript:alert(1)' }] },
    };
    expect(resumeContentSchema.safeParse(content).success).toBe(false);
  });

  it('accepte un lien http(s) valide', () => {
    const content = {
      ...validContent(),
      identity: { ...validContent().identity, links: [{ label: 'Portfolio', url: 'https://example.com' }] },
    };
    expect(resumeContentSchema.safeParse(content).success).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// resumeTailoringSchema / resumeTailoringWireSchema — round-trip et tolerance
// ---------------------------------------------------------------------------

function validWireTailoring() {
  return {
    title: 'Developpeuse React',
    summary: 'Resume adapte.',
    experiences: [{ id: 'e1', keep: true, order: 0, highlights: ['Point A'] }],
    educations: [{ id: 'ed1', keep: true }],
    skills: [{ id: 's1', order: 0 }],
    certifications: [{ id: 'c1', keep: false }],
    projects: [{ id: 'p1', keep: true, order: 0 }],
    notes: 'Mise en avant de React.',
  };
}

describe('resumeTailoringWireSchema / resumeTailoringSchema', () => {
  it('valide une sortie conforme au schema fil', () => {
    expect(resumeTailoringWireSchema.safeParse(validWireTailoring()).success).toBe(true);
  });

  it('refuse une cle inconnue sur le schema fil (strict)', () => {
    const result = resumeTailoringWireSchema.safeParse({ ...validWireTailoring(), extra: true });
    expect(result.success).toBe(false);
  });

  it('fait un aller-retour fil -> tolerant sans perte', () => {
    const wire = resumeTailoringWireSchema.parse(validWireTailoring());
    const tolerant = resumeTailoringSchema.parse(wire);
    expect(tolerant.title).toBe('Developpeuse React');
    expect(tolerant.experiences).toEqual([{ id: 'e1', keep: true, order: 0, highlights: ['Point A'] }]);
    expect(tolerant.skills).toEqual([{ id: 's1', order: 0 }]);
  });

  it('accepte des identifiants inconnus du profil (filtres par l_API, pas ici)', () => {
    const result = resumeTailoringSchema.safeParse({
      ...validWireTailoring(),
      experiences: [{ id: 'id-inconnu-du-profil', keep: true, order: 0, highlights: [] }],
    });
    expect(result.success).toBe(true);
  });

  it('ecarte une ligne mal formee (id absent ou ligne non-objet) plutot que de faire echouer toute la liste', () => {
    const result = resumeTailoringSchema.parse({
      experiences: [
        { id: 'valide', keep: true, order: 0, highlights: [] },
        { keep: true, order: 1, highlights: [] },
        'pas-un-objet',
      ],
    });
    expect(result.experiences).toEqual([{ id: 'valide', keep: true, order: 0, highlights: [] }]);
  });

  it('tronque un order non entier plutot que de rejeter la ligne', () => {
    const result = resumeTailoringSchema.parse({
      experiences: [{ id: 'e1', keep: true, order: 2.7, highlights: [] }],
    });
    expect(result.experiences).toEqual([{ id: 'e1', keep: true, order: 2, highlights: [] }]);
  });

  it('remplace un order absent par Number.MAX_SAFE_INTEGER sans ecarter la ligne', () => {
    const result = resumeTailoringSchema.parse({
      experiences: [{ id: 'e1', keep: false, highlights: [] }],
      skills: [{ id: 's1' }],
    });
    expect(result.experiences).toEqual([
      { id: 'e1', keep: false, order: Number.MAX_SAFE_INTEGER, highlights: [] },
    ]);
    expect(result.skills).toEqual([{ id: 's1', order: Number.MAX_SAFE_INTEGER }]);
  });

  it('ecarte une puce invalide sans ecarter la ligne (tolerance puce par puce)', () => {
    const result = resumeTailoringSchema.parse({
      experiences: [
        { id: 'e1', keep: true, order: 0, highlights: ['Puce valide', '', 'x'.repeat(400), 42, 'Autre puce valide'] },
      ],
    });
    expect(result.experiences).toEqual([
      { id: 'e1', keep: true, order: 0, highlights: ['Puce valide', 'Autre puce valide'] },
    ]);
  });

  it('pose des defauts (keep true, listes vides, textes vides) sur une entree minimale', () => {
    const result = resumeTailoringSchema.parse({});
    expect(result).toEqual({
      title: '',
      summary: '',
      experiences: [],
      educations: [],
      skills: [],
      certifications: [],
      projects: [],
      notes: '',
    });
  });

  it('tronque les listes de tailoring aux bornes (30 experiences au plus)', () => {
    const experiences = Array.from({ length: 35 }, (_, i) => ({ id: `e${i}`, keep: true, order: i, highlights: [] }));
    const result = resumeTailoringSchema.parse({ experiences });
    expect(result.experiences).toHaveLength(30);
  });
});

// ---------------------------------------------------------------------------
// coverLetterContentSchema / coverLetterWireSchema
// ---------------------------------------------------------------------------

function validLetter() {
  return {
    recipient: 'Madame Dupont',
    subject: 'Candidature',
    greeting: 'Madame, Monsieur,',
    paragraphs: ['Premier paragraphe.'],
    closing: 'Cordialement,',
    signature: 'Elodie Muller',
  };
}

describe('coverLetterContentSchema / coverLetterWireSchema', () => {
  it('accepte une lettre valide avec un destinataire null', () => {
    expect(coverLetterContentSchema.safeParse({ ...validLetter(), recipient: null }).success).toBe(true);
  });

  it('refuse une lettre sans paragraphe', () => {
    expect(coverLetterContentSchema.safeParse({ ...validLetter(), paragraphs: [] }).success).toBe(false);
  });

  it('refuse plus de 6 paragraphes', () => {
    const paragraphs = Array.from({ length: 7 }, (_, i) => `Paragraphe ${i}`);
    expect(coverLetterContentSchema.safeParse({ ...validLetter(), paragraphs }).success).toBe(false);
  });

  it('fait un aller-retour fil -> contenu sans perte', () => {
    const wire = coverLetterWireSchema.parse(validLetter());
    const content = coverLetterContentSchema.parse(wire);
    expect(content).toEqual(validLetter());
  });

  it('refuse un subject, greeting, closing ou signature vide sur le schema v3', () => {
    expect(coverLetterContentSchema.safeParse({ ...validLetter(), subject: '' }).success).toBe(false);
    expect(coverLetterContentSchema.safeParse({ ...validLetter(), greeting: '' }).success).toBe(false);
    expect(coverLetterContentSchema.safeParse({ ...validLetter(), closing: '' }).success).toBe(false);
    expect(coverLetterContentSchema.safeParse({ ...validLetter(), signature: '' }).success).toBe(false);
  });

  it('accepte un tableau de paragraphes vide sur le schema fil (pas de min, contrairement au schema v3)', () => {
    const result = coverLetterWireSchema.safeParse({ ...validLetter(), paragraphs: [] });
    expect(result.success).toBe(true);
  });

  it('expose des longueurs maximales par ton coherentes avec le spec', () => {
    expect(COVER_LETTER_MAX_CHARS).toEqual({ SHORT: 900, PROFESSIONAL: 1800, PERSONAL: 2600 });
  });
});

// ---------------------------------------------------------------------------
// resumeChangesSchema
// ---------------------------------------------------------------------------

describe('resumeChangesSchema', () => {
  it('accepte un diff complet valide', () => {
    const changes = {
      title: { before: 'Dev', after: 'Dev React' },
      summary: { before: 'Ancien resume', after: 'Nouveau resume' },
      experiences: [
        {
          id: 'e1',
          before: ['Ancienne puce'],
          after: ['Nouvelle puce'],
          kept: true,
          rejected: [{ index: 1, reason: 'Mention non presente dans votre profil.' }],
        },
      ],
      skills: { before: ['s1', 's2'], after: ['s2', 's1'] },
      educations: { kept: ['ed1'], removed: ['ed2'] },
      certifications: { kept: [], removed: ['c1'] },
      projects: { kept: ['p1'], removed: [] },
      notes: 'Mise en avant de React.',
    };
    expect(resumeChangesSchema.safeParse(changes).success).toBe(true);
  });

  it('accepte notes a null', () => {
    const changes = {
      title: { before: 'Dev', after: 'Dev' },
      summary: { before: 'R', after: 'R' },
      experiences: [],
      skills: { before: [], after: [] },
      educations: { kept: [], removed: [] },
      certifications: { kept: [], removed: [] },
      projects: { kept: [], removed: [] },
      notes: null,
    };
    expect(resumeChangesSchema.safeParse(changes).success).toBe(true);
  });

  it('refuse une cle inconnue (strict)', () => {
    const changes = {
      title: { before: 'Dev', after: 'Dev' },
      summary: { before: 'R', after: 'R' },
      experiences: [],
      skills: { before: [], after: [] },
      educations: { kept: [], removed: [] },
      certifications: { kept: [], removed: [] },
      projects: { kept: [], removed: [] },
      notes: null,
      extra: true,
    };
    expect(resumeChangesSchema.safeParse(changes).success).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Entrees des routes
// ---------------------------------------------------------------------------

describe('entrees des routes', () => {
  it('createTailoredResumeSchema accepte jobId et template', () => {
    expect(createTailoredResumeSchema.safeParse({ jobId: 'job1', template: 'CLASSIC' }).success).toBe(true);
  });

  it('createTailoredResumeSchema refuse un template inconnu', () => {
    expect(createTailoredResumeSchema.safeParse({ jobId: 'job1', template: 'FANCY' }).success).toBe(false);
  });

  it('updateResumeSchema exige un contenu valide et accepte un template optionnel', () => {
    const withoutTemplate = updateResumeSchema.safeParse({ content: validContent() });
    const withTemplate = updateResumeSchema.safeParse({ content: validContent(), template: 'MODERN' });
    expect(withoutTemplate.success).toBe(true);
    expect(withTemplate.success).toBe(true);
  });

  it('updateResumeTemplateSchema exige un template', () => {
    expect(updateResumeTemplateSchema.safeParse({}).success).toBe(false);
    expect(updateResumeTemplateSchema.safeParse({ template: 'CLASSIC' }).success).toBe(true);
  });

  it('createCoverLetterSchema accepte un resumeId optionnel', () => {
    expect(createCoverLetterSchema.safeParse({ jobId: 'job1', tone: 'SHORT' }).success).toBe(true);
    expect(createCoverLetterSchema.safeParse({ jobId: 'job1', tone: 'SHORT', resumeId: 'r1' }).success).toBe(true);
  });

  it('updateCoverLetterSchema exige un contenu de lettre valide', () => {
    expect(updateCoverLetterSchema.safeParse({ content: validLetter() }).success).toBe(true);
    expect(updateCoverLetterSchema.safeParse({ content: { ...validLetter(), paragraphs: [] } }).success).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// resumeFileName
// ---------------------------------------------------------------------------

describe('resumeFileName', () => {
  it('assainit accents et espaces (exemple du plan)', () => {
    const name = resumeFileName('CV', { firstName: 'Élodie', lastName: 'Müller' }, 'Société Générale');
    expect(name).toBe('CV-Elodie-Muller-Societe-Generale.pdf');
  });

  it('produit un nom de lettre distinct', () => {
    const name = resumeFileName('Lettre', { firstName: 'Elodie', lastName: 'Muller' }, 'Acme');
    expect(name).toBe('Lettre-Elodie-Muller-Acme.pdf');
  });

  it('omet le segment entreprise quand company est null', () => {
    const name = resumeFileName('CV', { firstName: 'Elodie', lastName: 'Muller' }, null);
    expect(name).toBe('CV-Elodie-Muller.pdf');
  });

  it('reste sous 80 caracteres, extension comprise', () => {
    const name = resumeFileName(
      'CV',
      { firstName: 'x'.repeat(60), lastName: 'y'.repeat(60) },
      'z'.repeat(60),
    );
    expect(name.length).toBeLessThanOrEqual(80);
    expect(name.endsWith('.pdf')).toBe(true);
    expect(name).not.toMatch(/-\.pdf$/);
  });

  it('ne produit jamais de caractere non ASCII', () => {
    const name = resumeFileName('CV', { firstName: 'Amélie', lastName: 'Ötz' }, 'Café & Co');
    expect(/^[\x20-\x7E]*$/.test(name)).toBe(true);
  });

  it('retombe sur un segment neutre quand le nom n_a aucun equivalent ASCII', () => {
    const cvName = resumeFileName('CV', { firstName: '田中', lastName: '太郎' }, null);
    expect(cvName).toBe('CV-Mon-CV.pdf');

    const letterName = resumeFileName('Lettre', { firstName: '田中', lastName: '太郎' }, null);
    expect(letterName).toBe('Lettre-Ma-Lettre.pdf');
  });
});

// ---------------------------------------------------------------------------
// Constantes (enumerations, libelles)
// ---------------------------------------------------------------------------

describe('constantes', () => {
  it('RESUME_TEMPLATES, COVER_LETTER_TONES, RESUME_VERSION_SOURCES portent les valeurs attendues', () => {
    expect(RESUME_TEMPLATES).toEqual(['CLASSIC', 'MODERN']);
    expect(COVER_LETTER_TONES).toEqual(['SHORT', 'PROFESSIONAL', 'PERSONAL']);
    expect(RESUME_VERSION_SOURCES).toEqual(['AI', 'USER']);
  });

  it('RESUME_SECTION_LABELS couvre les huit sections du CV', () => {
    expect(Object.keys(RESUME_SECTION_LABELS)).toEqual([
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
});
