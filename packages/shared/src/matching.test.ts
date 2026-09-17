import { describe, expect, it } from 'vitest';
import {
  FACTOR_KEYS,
  FACTOR_LABELS,
  FACTOR_WEIGHTS,
  MATCH_BAND_LABELS,
  MATCH_BANDS,
  MATCH_PRIORITIES,
  PRIORITY_LABELS,
  PRIORITY_THRESHOLDS,
  SCORE_BAND_THRESHOLDS,
  analyzeJobsSchema,
  jobRequirementsSchema,
  jobRequirementsWireSchema,
} from './matching';

function baseWireRequirements() {
  return {
    technologies: [{ name: 'React', required: true, category: 'framework' as const }],
    softSkills: ['Autonomie'],
    experienceYearsMin: 3,
    seniority: 'senior' as const,
    educationLevel: 'bac5' as const,
    educationFields: ['Informatique'],
    languages: [{ name: 'Anglais', level: 'B2' as const, required: true }],
    remoteMode: 'hybrid' as const,
    contractHints: ['Forfait jours'],
    mustHaves: ['Anglais courant'],
    niceToHaves: ['Kubernetes'],
    summary: 'Poste de développeur backend.',
  };
}

describe('jobRequirementsSchema — technologies', () => {
  it('bascule une categorie inconnue sur other sans ecarter la ligne', () => {
    const result = jobRequirementsSchema.parse({
      technologies: [
        { name: 'React', required: true, category: 'framework' },
        { name: 'Truc', required: false, category: 'inconnue' },
      ],
    });
    expect(result.technologies).toEqual([
      { name: 'React', required: true, category: 'framework' },
      { name: 'Truc', required: false, category: 'other' },
    ]);
  });

  it('tronque a 60 technologies', () => {
    const technologies = Array.from({ length: 65 }, (_, i) => ({
      name: `Tech${i}`,
      required: false,
      category: 'other',
    }));
    const result = jobRequirementsSchema.parse({ technologies });
    expect(result.technologies).toHaveLength(60);
  });

  it('borne le nom a 80 caracteres et defaut required a faux', () => {
    const result = jobRequirementsSchema.parse({
      technologies: [{ name: 'a'.repeat(200), category: 'tool' }],
    });
    expect(result.technologies[0]?.name.length).toBe(80);
    expect(result.technologies[0]?.required).toBe(false);
  });
});

describe('jobRequirementsSchema — listes de chaines', () => {
  it('ecarte les valeurs non-chaines et les entrees vides de softSkills', () => {
    const result = jobRequirementsSchema.parse({ softSkills: ['Rigueur', 42, '   ', null, 'Autonomie'] });
    expect(result.softSkills).toEqual(['Rigueur', 'Autonomie']);
  });

  it('tronque les textes libres (contractHints) a 300 caracteres', () => {
    const result = jobRequirementsSchema.parse({ contractHints: ['a'.repeat(400)] });
    expect(result.contractHints[0]?.length).toBe(300);
  });

  it('defaut a une liste vide quand le champ est absent', () => {
    const result = jobRequirementsSchema.parse({});
    expect(result.mustHaves).toEqual([]);
    expect(result.niceToHaves).toEqual([]);
    expect(result.educationFields).toEqual([]);
  });

  it('traite une valeur qui n est pas un tableau comme une liste vide, sans echouer', () => {
    const result = jobRequirementsSchema.parse({ softSkills: null, technologies: 'x' });
    expect(result.softSkills).toEqual([]);
    expect(result.technologies).toEqual([]);
  });
});

describe('jobRequirementsSchema — experienceYearsMin', () => {
  it('renvoie null pour une valeur non numerique', () => {
    expect(jobRequirementsSchema.parse({ experienceYearsMin: 'plusieurs annees' }).experienceYearsMin).toBeNull();
  });

  it('renvoie null quand le champ est absent', () => {
    expect(jobRequirementsSchema.parse({}).experienceYearsMin).toBeNull();
  });

  it('borne a 40 une valeur superieure', () => {
    expect(jobRequirementsSchema.parse({ experienceYearsMin: 60 }).experienceYearsMin).toBe(40);
  });

  it('borne a 0 une valeur negative', () => {
    expect(jobRequirementsSchema.parse({ experienceYearsMin: -5 }).experienceYearsMin).toBe(0);
  });

  it('renvoie null pour une chaine vide ou blanche', () => {
    expect(jobRequirementsSchema.parse({ experienceYearsMin: '' }).experienceYearsMin).toBeNull();
    expect(jobRequirementsSchema.parse({ experienceYearsMin: '   ' }).experienceYearsMin).toBeNull();
  });
});

describe('jobRequirementsSchema — enumerations nullables', () => {
  it('renvoie null pour une seniorite inconnue', () => {
    expect(jobRequirementsSchema.parse({ seniority: 'stagiaire' }).seniority).toBeNull();
  });

  it('renvoie null pour un niveau de formation inconnu', () => {
    expect(jobRequirementsSchema.parse({ educationLevel: 'master' }).educationLevel).toBeNull();
  });

  it('renvoie null pour un mode de teletravail inconnu', () => {
    expect(jobRequirementsSchema.parse({ remoteMode: 'partiel' }).remoteMode).toBeNull();
  });

  it('accepte une valeur valide', () => {
    expect(jobRequirementsSchema.parse({ remoteMode: 'remote' }).remoteMode).toBe('remote');
  });
});

describe('jobRequirementsSchema — languages', () => {
  it('ecarte une ligne sans nom', () => {
    const result = jobRequirementsSchema.parse({
      languages: [{ level: 'B2', required: true }, { name: 'Anglais', level: 'B2', required: true }],
    });
    expect(result.languages).toEqual([{ name: 'Anglais', level: 'B2', required: true }]);
  });

  it('conserve la ligne avec un niveau null quand le niveau est inconnu', () => {
    const result = jobRequirementsSchema.parse({
      languages: [{ name: 'Anglais', level: 'tres bon', required: false }],
    });
    expect(result.languages).toEqual([{ name: 'Anglais', level: null, required: false }]);
  });
});

describe('jobRequirementsSchema — summary', () => {
  it('renvoie une chaine vide quand absent ou non-chaine', () => {
    expect(jobRequirementsSchema.parse({}).summary).toBe('');
    expect(jobRequirementsSchema.parse({ summary: 123 }).summary).toBe('');
  });

  it('tronque a 300 caracteres', () => {
    expect(jobRequirementsSchema.parse({ summary: 'a'.repeat(400) }).summary.length).toBe(300);
  });
});

describe('jobRequirementsWireSchema — aller-retour', () => {
  it('une sortie du schema fil se reparse sans perte par le schema tolerant', () => {
    const wire = jobRequirementsWireSchema.parse(baseWireRequirements());
    const result = jobRequirementsSchema.parse(wire);
    expect(result).toEqual(baseWireRequirements());
  });

  it('rejette une cle inconnue (.strict())', () => {
    expect(() => jobRequirementsWireSchema.parse({ ...baseWireRequirements(), extra: true })).toThrow();
  });
});

describe('analyzeJobsSchema', () => {
  it('dedoublonne les identifiants', () => {
    const result = analyzeJobsSchema.parse({ jobIds: ['a', 'b', 'a'] });
    expect(result.jobIds).toEqual(['a', 'b']);
  });

  it('rejette une liste vide', () => {
    expect(analyzeJobsSchema.safeParse({ jobIds: [] }).success).toBe(false);
  });

  it('rejette plus de 20 identifiants', () => {
    const jobIds = Array.from({ length: 21 }, (_, i) => `job-${i}`);
    expect(analyzeJobsSchema.safeParse({ jobIds }).success).toBe(false);
  });

  it('accepte exactement 20 identifiants', () => {
    const jobIds = Array.from({ length: 20 }, (_, i) => `job-${i}`);
    expect(analyzeJobsSchema.safeParse({ jobIds }).success).toBe(true);
  });
});

describe('libelles et poids', () => {
  it('MATCH_BAND_LABELS couvre chaque bande', () => {
    expect(Object.keys(MATCH_BAND_LABELS).sort()).toEqual([...MATCH_BANDS].sort());
  });

  it('PRIORITY_LABELS couvre chaque priorite', () => {
    expect(Object.keys(PRIORITY_LABELS).sort()).toEqual([...MATCH_PRIORITIES].sort());
  });

  it('FACTOR_LABELS couvre chaque facteur', () => {
    expect(Object.keys(FACTOR_LABELS).sort()).toEqual([...FACTOR_KEYS].sort());
  });

  it('FACTOR_WEIGHTS couvre chaque facteur et la somme vaut 100', () => {
    expect(Object.keys(FACTOR_WEIGHTS).sort()).toEqual([...FACTOR_KEYS].sort());
    const total = Object.values(FACTOR_WEIGHTS).reduce((sum, weight) => sum + weight, 0);
    expect(total).toBe(100);
  });

  it('SCORE_BAND_THRESHOLDS reprend les seuils de la spec (85/70/50)', () => {
    expect(SCORE_BAND_THRESHOLDS).toEqual({ EXCELLENT: 85, GOOD: 70, PARTIAL: 50 });
  });

  it('PRIORITY_THRESHOLDS reprend les seuils de la spec (85/75/60/45)', () => {
    expect(PRIORITY_THRESHOLDS).toEqual({ VERY_HIGH: 85, HIGH: 75, GOOD: 60, CONSIDER: 45 });
  });
});
