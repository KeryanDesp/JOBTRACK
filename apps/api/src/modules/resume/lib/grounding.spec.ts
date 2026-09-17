import type { CoverLetterContent, ResumeContent, ResumeTailoringInput } from '@jobtrack/shared';
import { describe, expect, it } from 'vitest';
import { AiOutputInvalidError } from '../resume.errors';
import { buildKnownNumbers, buildKnownTerms, groundLetter, groundTailoring, isGrounded } from './grounding';

function baseContent(): ResumeContent {
  return {
    schemaVersion: 1,
    identity: { firstName: 'Camille', lastName: 'Martin', title: 'Développeuse' },
    summary: 'Développeuse expérimentée ayant conçu des applications web chez Solaris Ingénierie.',
    experiences: [
      {
        id: 'exp-1',
        company: 'Solaris Ingénierie',
        role: 'Développeuse React',
        location: null,
        startDate: '2021-01-01',
        endDate: null,
        isCurrent: true,
        highlights: [
          'Pilote une équipe de 5 personnes chez Solaris Ingénierie.',
          'Mise en place de React et Node.js sur la plateforme.',
        ],
        sourceDescription:
          'Pilote une équipe de 5 personnes chez Solaris Ingénierie. Mise en place de React et Node.js sur la plateforme.',
      },
      {
        id: 'exp-2',
        company: 'Piloto Software',
        role: 'Ingénieure logicielle',
        location: null,
        startDate: '2018-01-01',
        endDate: '2020-12-31',
        isCurrent: false,
        highlights: ['Développement backend avec Java.'],
        sourceDescription: 'Développement backend avec Java.',
      },
    ],
    educations: [
      {
        id: 'edu-1',
        school: 'Université Paris',
        degree: 'Master informatique',
        field: null,
        startDate: '2015-01-01',
        endDate: '2017-01-01',
      },
    ],
    skills: [
      { id: 'skill-1', name: 'ReactJS', category: 'TECHNICAL', level: 'ADVANCED' },
      { id: 'skill-2', name: 'SQL', category: 'TECHNICAL', level: 'INTERMEDIATE' },
    ],
    languages: [{ id: 'lang-1', name: 'Anglais', level: 'B2' }],
    certifications: [{ id: 'cert-1', name: 'AWS Certified', issuer: 'Amazon', issuedAt: '2022-01-01' }],
    projects: [{ id: 'proj-1', name: 'Kubernetes Operator', description: null, url: null, technologies: ['Kubernetes', 'Docker'] }],
  };
}

function baseTailoring(overrides: Partial<ResumeTailoringInput> = {}): ResumeTailoringInput {
  return {
    title: '',
    summary: '',
    experiences: [],
    educations: [],
    skills: [],
    certifications: [],
    projects: [],
    notes: '',
    ...overrides,
  };
}

function baseLetter(paragraphs: string[]): CoverLetterContent {
  return {
    recipient: 'Madame Dupont',
    subject: 'Candidature',
    greeting: 'Madame, Monsieur,',
    paragraphs,
    closing: 'Cordialement,',
    signature: 'Camille Martin',
  };
}

describe('isGrounded', () => {
  it('rejette un nombre invente absent des sources', () => {
    const result = isGrounded('Augmentation du chiffre d_affaires de 30 %.', ['Aucun chiffre mentionne ici.'], new Set());
    expect(result.ok).toBe(false);
    // Forme de surface d'origine (revue) : pas la clé canonique.
    expect(result.missingNumbers).toContain('30 %');
  });

  it('accepte un nombre present dans les sources, virgule ou point', () => {
    const result = isGrounded('Croissance de 2,5 fois.', ['Croissance mesuree a 2.5 fois cette annee.'], new Set());
    expect(result.ok).toBe(true);
  });

  it('rejette une entite inconnue absente des sources et des termes connus', () => {
    const result = isGrounded('Deploiement sur Kubernetes.', ['Mission realisee sans mention technique.'], new Set());
    expect(result.ok).toBe(false);
    // Forme de surface d'origine (revue) : pas la clé canonique.
    expect(result.missingTerms).toContain('Kubernetes');
  });

  it('accepte une entite presente dans les termes connus du profil', () => {
    const result = isGrounded('Deploiement sur Kubernetes.', ['Mission realisee sans mention technique.'], new Set(['kubernetes']));
    expect(result.ok).toBe(true);
  });

  it('accepte un sigle present dans les sources', () => {
    const result = isGrounded('Ecriture de requetes SQL.', ['Maitrise du langage SQL au quotidien.'], new Set());
    expect(result.ok).toBe(true);
  });

  it('accepte une entite via sa forme canonique (React vs ReactJS)', () => {
    const result = isGrounded('Utilisation de React.', ['Expertise en ReactJS reconnue.'], new Set());
    expect(result.ok).toBe(true);
  });
});

describe('buildKnownTerms', () => {
  it('inclut les competences, projets, technologies et entreprises du profil', () => {
    const terms = buildKnownTerms(baseContent());
    expect(terms.has('react')).toBe(true);
    expect(terms.has('sql')).toBe(true);
    expect(terms.has('kubernetes')).toBe(true);
    expect(terms.has('solaris ingenierie')).toBe(true);
  });
});

describe('groundTailoring — experiences', () => {
  it('conserve les puces de base quand la ligne ne propose aucune reformulation', () => {
    const base = baseContent();
    const tailoring = baseTailoring({ experiences: [{ id: 'exp-1', keep: true, order: 0, highlights: [] }] });
    const { content } = groundTailoring(base, tailoring);
    expect(content.experiences[0]?.highlights).toEqual(base.experiences[0]?.highlights);
  });

  it('accepte une reformulation ancree dans la source', () => {
    const base = baseContent();
    const tailoring = baseTailoring({
      experiences: [{ id: 'exp-1', keep: true, order: 0, highlights: ['Direction de 5 personnes chez Solaris Ingénierie.'] }],
    });
    const { content, rejected } = groundTailoring(base, tailoring);
    expect(content.experiences[0]?.highlights).toEqual(['Direction de 5 personnes chez Solaris Ingénierie.']);
    expect(rejected).toHaveLength(0);
  });

  it('rejette un nombre invente et le remplace par la puce de base au meme index', () => {
    const base = baseContent();
    const tailoring = baseTailoring({
      experiences: [{ id: 'exp-1', keep: true, order: 0, highlights: ['Direction de 30 personnes chez Solaris Ingénierie.'] }],
    });
    const { content, rejected } = groundTailoring(base, tailoring);
    expect(content.experiences[0]?.highlights[0]).toBe(base.experiences[0]?.highlights[0]);
    expect(rejected).toHaveLength(1);
    expect(rejected[0]?.reason).toContain('30');
  });

  it('rejette une entite inventee et signale la raison', () => {
    const base = baseContent();
    const tailoring = baseTailoring({
      // « Azure » n'apparaît nulle part dans le profil (contrairement à
      // « Kubernetes », un projet du profil) : doit être rejetée.
      experiences: [{ id: 'exp-1', keep: true, order: 0, highlights: ['Deploiement sur Azure chez Solaris Ingénierie.'] }],
    });
    const { rejected } = groundTailoring(base, tailoring);
    expect(rejected).toHaveLength(1);
    expect(rejected[0]?.reason).toContain('entité non présente');
  });

  it('accepte une entite technologique connue du profil meme absente de la source de l_experience', () => {
    const base = baseContent();
    const tailoring = baseTailoring({
      experiences: [{ id: 'exp-2', keep: true, order: 0, highlights: ['Utilisation de Kubernetes en production.'] }],
    });
    const { rejected } = groundTailoring(base, tailoring);
    expect(rejected).toHaveLength(0);
  });

  it('abandonne une puce rejetee quand la base n_a pas de puce au meme index', () => {
    const base = baseContent();
    const tailoring = baseTailoring({
      experiences: [
        {
          id: 'exp-2',
          keep: true,
          order: 0,
          highlights: ['Développement backend avec Java.', 'Utilisation de Azure en direct.'],
        },
      ],
    });
    const { content, rejected } = groundTailoring(base, tailoring);
    // exp-2 porte une ligne de reformulation, elle passe donc devant exp-1 (sans ligne) une
    // fois l_ordre applique. Elle n_a qu_une seule puce de base : la seconde reformulation
    // rejetee (« Azure » n_est pas connue ici, ni presente) est simplement abandonnee, faute
    // de repli.
    expect(content.experiences[0]?.id).toBe('exp-2');
    expect(content.experiences[0]?.highlights).toEqual(['Développement backend avec Java.']);
    expect(rejected[0]?.replacement).toBe('');
  });

  it('rejette une puce vide', () => {
    const base = baseContent();
    const tailoring = baseTailoring({ experiences: [{ id: 'exp-1', keep: true, order: 0, highlights: ['   '] }] });
    const { rejected } = groundTailoring(base, tailoring);
    expect(rejected[0]?.reason).toBe('reformulation vide');
  });

  it('rejette une puce trop longue', () => {
    const base = baseContent();
    const tailoring = baseTailoring({
      experiences: [{ id: 'exp-1', keep: true, order: 0, highlights: ['a'.repeat(301)] }],
    });
    const { rejected } = groundTailoring(base, tailoring);
    expect(rejected[0]?.reason).toContain('trop longue');
  });

  it('ignore un identifiant d_experience inconnu', () => {
    const base = baseContent();
    const tailoring = baseTailoring({
      experiences: [{ id: 'exp-inconnu', keep: true, order: 0, highlights: ['Peu importe.'] }],
    });
    const { content } = groundTailoring(base, tailoring);
    expect(content.experiences.map((e) => e.id)).toEqual(['exp-1', 'exp-2']);
  });

  it('applique l_ordre demande par l_IA', () => {
    const base = baseContent();
    const tailoring = baseTailoring({
      experiences: [
        { id: 'exp-2', keep: true, order: 0, highlights: [] },
        { id: 'exp-1', keep: true, order: 1, highlights: [] },
      ],
    });
    const { content } = groundTailoring(base, tailoring);
    expect(content.experiences.map((e) => e.id)).toEqual(['exp-2', 'exp-1']);
  });

  it('ecarte une experience marquee keep false mais la garde disponible dans les changements', () => {
    const base = baseContent();
    const tailoring = baseTailoring({ experiences: [{ id: 'exp-2', keep: false, order: 0, highlights: [] }] });
    const { content } = groundTailoring(base, tailoring);
    expect(content.experiences.map((e) => e.id)).toEqual(['exp-1']);
  });

  it('ajoute apres les elements ordonnes une experience absente de la sortie de l_IA', () => {
    const base = baseContent();
    const tailoring = baseTailoring({ experiences: [{ id: 'exp-2', keep: true, order: 0, highlights: [] }] });
    const { content } = groundTailoring(base, tailoring);
    expect(content.experiences.map((e) => e.id)).toEqual(['exp-2', 'exp-1']);
  });
});

describe('groundTailoring — competences, formations, certifications, projets', () => {
  it('ordonne les competences selon order puis ajoute les autres dans l_ordre de base', () => {
    const base = baseContent();
    const tailoring = baseTailoring({ skills: [{ id: 'skill-2', order: 0 }] });
    const { content } = groundTailoring(base, tailoring);
    expect(content.skills.map((s) => s.id)).toEqual(['skill-2', 'skill-1']);
  });

  it('ecarte une formation marquee keep false', () => {
    const base = baseContent();
    const tailoring = baseTailoring({ educations: [{ id: 'edu-1', keep: false }] });
    const { content } = groundTailoring(base, tailoring);
    expect(content.educations).toHaveLength(0);
  });

  it('ecarte une certification marquee keep false', () => {
    const base = baseContent();
    const tailoring = baseTailoring({ certifications: [{ id: 'cert-1', keep: false }] });
    const { content } = groundTailoring(base, tailoring);
    expect(content.certifications).toHaveLength(0);
  });

  it('ordonne les projets selon order', () => {
    const base = baseContent();
    const firstProject = base.projects[0];
    if (firstProject === undefined) throw new Error('fixture invalide : aucun projet de base');
    const extraProject = { ...firstProject, id: 'proj-2', name: 'Autre projet' };
    const withTwoProjects = { ...base, projects: [...base.projects, extraProject] };
    const tailoring = baseTailoring({
      projects: [
        { id: 'proj-2', keep: true, order: 0 },
        { id: 'proj-1', keep: true, order: 1 },
      ],
    });
    const { content } = groundTailoring(withTwoProjects, tailoring);
    expect(content.projects.map((p) => p.id)).toEqual(['proj-2', 'proj-1']);
  });
});

describe('groundTailoring — resume et titre', () => {
  it('accepte un resume reformule ancre', () => {
    const base = baseContent();
    const tailoring = baseTailoring({ summary: 'Développeuse chez Solaris Ingénierie, experte React.' });
    const { content, summaryRejected } = groundTailoring(base, tailoring);
    expect(summaryRejected).toBe(false);
    expect(content.summary).toBe('Développeuse chez Solaris Ingénierie, experte React.');
  });

  it('rejette un resume avec un nombre invente et garde le resume de base', () => {
    const base = baseContent();
    const tailoring = baseTailoring({ summary: 'Développeuse avec 15 ans d_experience.' });
    const { content, summaryRejected } = groundTailoring(base, tailoring);
    expect(summaryRejected).toBe(true);
    expect(content.summary).toBe(base.summary);
  });

  it('garde le resume de base quand aucun resume n_est propose', () => {
    const base = baseContent();
    const { content, summaryRejected } = groundTailoring(base, baseTailoring());
    expect(summaryRejected).toBe(false);
    expect(content.summary).toBe(base.summary);
  });

  it('accepte un titre propose sans nombre', () => {
    const base = baseContent();
    const { content, titleRejected } = groundTailoring(base, baseTailoring({ title: 'Développeuse Frontend Senior' }));
    expect(titleRejected).toBe(false);
    expect(content.identity.title).toBe('Développeuse Frontend Senior');
  });

  it('rejette un titre contenant un nombre', () => {
    const base = baseContent();
    const { content, titleRejected } = groundTailoring(base, baseTailoring({ title: 'Développeuse avec 10 ans d_experience' }));
    expect(titleRejected).toBe(true);
    expect(content.identity.title).toBe(base.identity.title);
  });
});

describe('groundTailoring — determinisme', () => {
  it('produit le meme resultat pour la meme entree', () => {
    const base = baseContent();
    const tailoring = baseTailoring({
      title: 'Développeuse Frontend',
      summary: 'Développeuse chez Solaris Ingénierie.',
      experiences: [{ id: 'exp-1', keep: true, order: 0, highlights: ['Direction de 5 personnes chez Solaris Ingénierie.'] }],
      skills: [{ id: 'skill-2', order: 0 }],
    });
    const first = groundTailoring(base, tailoring);
    const second = groundTailoring(base, tailoring);
    expect(first).toEqual(second);
  });
});

describe('groundLetter', () => {
  it('retire une phrase non ancree et garde le reste du paragraphe', () => {
    const letter = baseLetter([
      'Je maitrise React. J_ai gere une equipe de 200 personnes chez Solaris Ingénierie.',
    ]);
    const { content, removedSentences } = groundLetter(
      letter,
      ['Expertise en ReactJS reconnue.', 'Equipe de 5 personnes chez Solaris Ingénierie.'],
      new Set(),
      'PROFESSIONAL',
    );
    expect(content.paragraphs[0]).toContain('Je maitrise React.');
    expect(content.paragraphs[0]).not.toContain('200');
    expect(removedSentences).toHaveLength(1);
  });

  it('supprime un paragraphe entierement non ancre', () => {
    // Le premier mot de phrase (« Mission ») n_est plus exempte par defaut (revue, item 1) :
    // il doit donc etre repris identiquement dans la source pour rester ancre.
    const letter = baseLetter(['Mission chez Solaris Ingénierie menée avec succès.', 'Invente 500 recrutements.']);
    const { content } = groundLetter(letter, ['Mission chez Solaris Ingénierie.'], new Set(), 'PROFESSIONAL');
    expect(content.paragraphs).toEqual(['Mission chez Solaris Ingénierie menée avec succès.']);
  });

  it('utilise la phrase de repli quand tout est retire', () => {
    const letter = baseLetter(['Invente 500 recrutements chez Kubernetes.']);
    const { content } = groundLetter(letter, ['Mission realisee sans chiffre.'], new Set(), 'SHORT');
    expect(content.paragraphs).toEqual(["Je vous propose d'échanger sur ma candidature."]);
  });

  it('plafonne la longueur totale selon le ton', () => {
    const longSentence = 'Phrase ancree repetee de nombreuses fois pour depasser la limite du ton court. ';
    const paragraphs = [longSentence.repeat(20)];
    const letter = baseLetter(paragraphs);
    const { content } = groundLetter(letter, [longSentence.repeat(20)], new Set(), 'SHORT');
    const totalLength = content.paragraphs.join(' ').length;
    expect(totalLength).toBeLessThanOrEqual(900);
  });

  it('assainit les champs hors paragraphes des caracteres de controle', () => {
    const letter = baseLetter(['Paragraphe simple chez Solaris Ingénierie.']);
    const withControlChars = { ...letter, subject: `Candidature\u0000` };
    const { content } = groundLetter(withControlChars, ['Mission chez Solaris Ingénierie.'], new Set(), 'PROFESSIONAL');
    expect(content.subject).toBe('Candidature');
  });

  it('assainit un paragraphe des caracteres de controle avant de le decouper en phrases (item 6)', () => {
    // Le caractere de controle est place au milieu de la phrase : s_il n_etait pas retire
    // avant `sentences()`, il romprait la detection de fin de phrase ou laisserait un
    // caractere indesirable dans le texte final.
    const letter = baseLetter([`Mission\u0000 chez Solaris Ingénierie menée avec succès.`]);
    const { content } = groundLetter(letter, ['Mission chez Solaris Ingénierie.'], new Set(), 'PROFESSIONAL');
    expect(content.paragraphs).toEqual(['Mission chez Solaris Ingénierie menée avec succès.']);
  });

  it('est deterministe pour la meme entree', () => {
    const letter = baseLetter(['Paragraphe ancre chez Solaris Ingénierie.']);
    const sources = ['Mission chez Solaris Ingénierie.'];
    const first = groundLetter(letter, sources, new Set(), 'PERSONAL');
    const second = groundLetter(letter, sources, new Set(), 'PERSONAL');
    expect(first).toEqual(second);
  });

  it('rejette une entite inventee en tete de phrase dans un paragraphe de lettre (regression item 1)', () => {
    const letter = baseLetter(['Kubernetes a permis de transformer nos livraisons chez Solaris Ingénierie.']);
    const { removedSentences } = groundLetter(letter, ['Mission chez Solaris Ingénierie.'], new Set(), 'PROFESSIONAL');
    expect(removedSentences).toHaveLength(1);
  });

  it('sujet compose uniquement de caracteres de controle : AiOutputInvalidError, jamais une ZodError brute (revue securite)', () => {
    // `stripControlChars` reduit ce sujet a une chaine vide, qui viole `coverLetterContentSchema`
    // (`subject` requis, `.min(1)` implicite via l_absence de valeur par defaut) — doit toujours
    // remonter en `AiOutputInvalidError` (502), jamais en `ZodError` (500).
    const letter = { ...baseLetter(['Paragraphe ancre chez Solaris Ingénierie.']), subject: '\u0000\u0000' };
    expect(() => groundLetter(letter, ['Mission chez Solaris Ingénierie.'], new Set(), 'PROFESSIONAL')).toThrow(
      AiOutputInvalidError,
    );
  });
});

describe('isGrounded — regression : entite inventee en tete de phrase (item 1)', () => {
  it('rejette une entite inventee qui ouvre la phrase, meme sans autre mot capitalise ensuite', () => {
    // Avant la revue, seule la casse indiquait un debut de phrase et le premier mot etait
    // toujours exempte : « Kubernetes déployé en production. » passait sans aucune verification.
    const result = isGrounded('Kubernetes déployé en production.', ['Texte de reference neutre sans rapport.'], new Set());
    expect(result.ok).toBe(false);
    expect(result.missingTerms).toContain('Kubernetes');
  });

  it('rejette une entite inventee en tete de puce de CV', () => {
    const base = baseContent();
    // « Terraform » n_apparait nulle part dans ce profil (ne se termine pas non plus par
    // une des terminaisons ordinaires reconnues, contrairement a « Azure » qui finit en
    // « -ure » comme « structure » — piege deliberement evite ici).
    const tailoring = baseTailoring({
      experiences: [{ id: 'exp-1', keep: true, order: 0, highlights: ['Terraform deploye en production chez Solaris Ingénierie.'] }],
    });
    const { rejected } = groundTailoring(base, tailoring);
    expect(rejected).toHaveLength(1);
    expect(rejected[0]?.reason).toContain('Terraform');
  });
});

describe('isGrounded — mots ordinaires francais en tete de phrase restent ancres (item 1)', () => {
  it('ne rejette aucune des dix formulations usuelles de puce de CV', () => {
    const ordinaryOpeners = [
      'Mise en place de nouveaux outils internes.',
      'Conception de l architecture logicielle du produit.',
      'Pilotage de projets transverses au sein de l equipe.',
      'Développement de fonctionnalités clés du produit.',
      'Gestion de la relation client au quotidien.',
      'Formation de nouveaux collaborateurs sur les outils internes.',
      'Réalisation de tests automatisés sur la plateforme.',
      'Optimisation des performances du systeme.',
      'Encadrement de l equipe technique au quotidien.',
      'Direction de la feuille de route produit.',
    ];
    const neutralSource = ['Texte de reference neutre sans rapport avec les puces testees.'];

    for (const opener of ordinaryOpeners) {
      const result = isGrounded(opener, neutralSource, new Set());
      expect(result.ok).toBe(true);
    }
  });
});

describe('groundTailoring — dates comme sources (item 2)', () => {
  it('ancre un nombre present uniquement dans la date de debut de l_experience (depuis 2021)', () => {
    const base = baseContent(); // exp-1.startDate === '2021-01-01'
    const tailoring = baseTailoring({
      experiences: [{ id: 'exp-1', keep: true, order: 0, highlights: ['En poste depuis 2021 chez Solaris Ingénierie.'] }],
    });
    const { rejected } = groundTailoring(base, tailoring);
    expect(rejected).toHaveLength(0);
  });

  it('ancre un nombre present uniquement dans une date de formation ou de certification', () => {
    const base = baseContent(); // edu-1.startDate === '2015-01-01', cert-1.issuedAt === '2022-01-01'
    const tailoring = baseTailoring({
      summary: 'Diplômée depuis 2015 et certifiée depuis 2022, experte chez Solaris Ingénierie.',
    });
    const { summaryRejected } = groundTailoring(base, tailoring);
    expect(summaryRejected).toBe(false);
  });
});

describe('buildKnownTerms — elargi a tout le profil (item 3)', () => {
  it('inclut un terme present uniquement dans les puces d_une autre experience', () => {
    const terms = buildKnownTerms(baseContent());
    // « Java » n_apparait que dans les puces de exp-2, jamais dans les competences/projets.
    expect(terms.has('java')).toBe(true);
  });

  it('inclut le nom d_une ecole et l_emetteur d_une certification', () => {
    const terms = buildKnownTerms(baseContent());
    expect(terms.has('universite paris')).toBe(true);
    expect(terms.has('amazon')).toBe(true);
  });

  it('accepte, en ancrage, un terme connu uniquement via une autre experience', () => {
    const base = baseContent();
    const tailoring = baseTailoring({
      experiences: [{ id: 'exp-1', keep: true, order: 0, highlights: ['Collaboration etroite avec les equipes Java.'] }],
    });
    const { rejected } = groundTailoring(base, tailoring);
    expect(rejected).toHaveLength(0);
  });
});

describe('buildKnownNumbers (item 4)', () => {
  it('inclut un nombre present uniquement dans le nom d_une competence', () => {
    const base = baseContent();
    const withVersionedSkill = {
      ...base,
      skills: [...base.skills, { id: 'skill-3', name: 'React 18', category: 'TECHNICAL' as const, level: 'ADVANCED' as const }],
    };
    expect(buildKnownNumbers(withVersionedSkill).has('18')).toBe(true);
  });

  it('ancre, en ancrage, un nombre connu uniquement via le nom d_une competence (React 18)', () => {
    const base = baseContent();
    const withVersionedSkill = {
      ...base,
      skills: [...base.skills, { id: 'skill-3', name: 'React 18', category: 'TECHNICAL' as const, level: 'ADVANCED' as const }],
    };
    const tailoring = baseTailoring({
      experiences: [{ id: 'exp-1', keep: true, order: 0, highlights: ['Utilisation de la version 18 de React.'] }],
    });
    const { rejected } = groundTailoring(withVersionedSkill, tailoring);
    expect(rejected).toHaveLength(0);
  });
});

describe('isGrounded — entite multi-mots : repli sur les composants (item 5)', () => {
  it('ancre une entite multi-mots quand chaque composant est individuellement connu (Docker Java)', () => {
    const base = baseContent(); // Docker via le projet, Java via les puces de exp-2 (item 3)
    const tailoring = baseTailoring({
      experiences: [{ id: 'exp-1', keep: true, order: 0, highlights: ['Développement de la stack Docker Java complete.'] }],
    });
    const { rejected } = groundTailoring(base, tailoring);
    expect(rejected).toHaveLength(0);
  });

  it('rejette une entite multi-mots inconnue et ne signale que ses composants inconnus (Google Cloud)', () => {
    const base = baseContent();
    const tailoring = baseTailoring({
      experiences: [{ id: 'exp-1', keep: true, order: 0, highlights: ['Migration vers Google Cloud effectuee.'] }],
    });
    const { rejected } = groundTailoring(base, tailoring);
    expect(rejected).toHaveLength(1);
    expect(rejected[0]?.reason).toContain('Google');
    expect(rejected[0]?.reason).toContain('Cloud');
  });
});

describe('groundTailoring — table de lignes partagee (item 9)', () => {
  it('utilise la meme ligne (premiere occurrence) pour la selection et pour les puces en cas d_id duplique', () => {
    const base = baseContent();
    const tailoring = baseTailoring({
      experiences: [
        { id: 'exp-2', keep: true, order: 0, highlights: ['Développement backend avec Java.'] },
        // Meme id, seconde occurrence : keep/order/highlights differents, doit etre ignoree.
        { id: 'exp-2', keep: false, order: 9, highlights: ['Devrait etre ignoree.'] },
      ],
    });
    const { content } = groundTailoring(base, tailoring);
    expect(content.experiences.map((e) => e.id)).toContain('exp-2');
    expect(content.experiences.find((e) => e.id === 'exp-2')?.highlights).toEqual(['Développement backend avec Java.']);
  });
});

describe('groundLetter — plafond de longueur avec separateurs de paragraphe (item 10)', () => {
  it('compte les separateurs entre paragraphes dans le plafond de longueur', () => {
    const sentenceText = 'Phrase ancree relativement longue pour approcher la limite du ton court sans la depasser.';
    const letter = baseLetter([sentenceText, sentenceText, sentenceText]);
    const { content } = groundLetter(letter, [sentenceText], new Set(), 'SHORT');
    const textLength = content.paragraphs.reduce((sum, paragraph) => sum + paragraph.length, 0);
    const separatorsLength = Math.max(content.paragraphs.length - 1, 0) * 2;
    expect(textLength + separatorsLength).toBeLessThanOrEqual(900);
  });
});

describe('groundTailoring — garde AI_OUTPUT_INVALID (revue finale item 2)', () => {
  it('leve AiOutputInvalidError si le contenu assemble ne respecte plus resumeContentSchema', () => {
    // Contorsion volontaire : `schemaVersion` n'est jamais modifie par `groundTailoring`, donc ce
    // chemin n'est aujourd'hui jamais atteint en pratique (voir le commentaire dans grounding.ts) —
    // seul un cast permet de forcer un `base` deja hors schema pour exercer la garde elle-meme.
    const base = { ...baseContent(), schemaVersion: 2 } as unknown as ResumeContent;
    expect(() => groundTailoring(base, baseTailoring())).toThrow(AiOutputInvalidError);
  });
});
