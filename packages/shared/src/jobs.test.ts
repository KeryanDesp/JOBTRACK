import { describe, expect, it } from 'vitest';
import {
  CONTRACT_TYPE_LABELS,
  EXPERIENCE_LEVEL_LABELS,
  JOB_SOURCE_KINDS,
  JOB_SOURCE_LABELS,
  JOB_TAB_VALUES,
  JOB_SORT_VALUES,
  PUBLISHED_WITHIN_OPTIONS,
  REMOTE_MODE_LABELS,
  jobSearchQuerySchema,
  parseJobSearchParams,
} from './jobs';
import { contractTypeSchema, experienceLevelSchema, remoteModeSchema } from './profile';

describe('jobSearchQuerySchema — defauts', () => {
  it('applique tous les defauts sur un objet vide', () => {
    const result = jobSearchQuerySchema.parse({});
    expect(result).toEqual({
      q: '',
      communes: [],
      distance: 10,
      contractTypes: [],
      remoteModes: [],
      experienceLevels: [],
      salaryMin: undefined,
      publishedWithinDays: undefined,
      sources: [],
      sort: 'recent',
      tab: 'all',
      page: 1,
      pageSize: 20,
      refresh: false,
    });
  });

  it('applique les memes defauts depuis un URLSearchParams vide', () => {
    const result = parseJobSearchParams(new URLSearchParams());
    expect(result.q).toBe('');
    expect(result.communes).toEqual([]);
    expect(result.distance).toBe(10);
    expect(result.sort).toBe('recent');
    expect(result.tab).toBe('all');
    expect(result.page).toBe(1);
    expect(result.pageSize).toBe(20);
    expect(result.refresh).toBe(false);
  });
});

describe('jobSearchQuerySchema — champs tableau', () => {
  it('regroupe les cles repetees en tableau', () => {
    const params = new URLSearchParams();
    params.append('contractTypes', 'CDI');
    params.append('contractTypes', 'CDD');
    const result = parseJobSearchParams(params);
    expect(result.contractTypes).toEqual(['CDI', 'CDD']);
  });

  it('accepte des valeurs separees par des virgules', () => {
    const params = new URLSearchParams({ contractTypes: 'CDI,CDD' });
    const result = parseJobSearchParams(params);
    expect(result.contractTypes).toEqual(['CDI', 'CDD']);
  });

  it('dedoublonne les valeurs repetees', () => {
    const params = new URLSearchParams({ contractTypes: 'CDI,CDI,CDD' });
    const result = parseJobSearchParams(params);
    expect(result.contractTypes).toEqual(['CDI', 'CDD']);
  });

  it('dedoublonne les communes', () => {
    const params = new URLSearchParams({ communes: '75001,75001,69001' });
    const result = parseJobSearchParams(params);
    expect(result.communes).toEqual(['75001', '69001']);
  });

  it('accepte un code commune corse (2A/2B)', () => {
    const result = jobSearchQuerySchema.safeParse({ communes: '2A004' });
    expect(result.success).toBe(true);
    if (result.success) expect(result.data.communes).toEqual(['2A004']);
  });
});

describe('jobSearchQuerySchema — validation et repli sur defaut', () => {
  it('rejette un code commune invalide en safeParse', () => {
    const result = jobSearchQuerySchema.safeParse({ communes: 'abcde' });
    expect(result.success).toBe(false);
  });

  it('retombe sur les defauts complets quand une commune est invalide', () => {
    const params = new URLSearchParams({ communes: 'abcde', q: 'developpeur' });
    const result = parseJobSearchParams(params);
    expect(result.communes).toEqual([]);
    expect(result.q).toBe('');
  });

  it('rejette plus de 3 communes', () => {
    const result = jobSearchQuerySchema.safeParse({ communes: '75001,69001,13001,33000' });
    expect(result.success).toBe(false);
  });

  it('rejette une distance hors bornes', () => {
    expect(jobSearchQuerySchema.safeParse({ distance: '101' }).success).toBe(false);
    expect(jobSearchQuerySchema.safeParse({ distance: '-1' }).success).toBe(false);
  });

  it('rejette une page inferieure a 1', () => {
    expect(jobSearchQuerySchema.safeParse({ page: '0' }).success).toBe(false);
  });

  it('rejette une pageSize differente de 20', () => {
    expect(jobSearchQuerySchema.safeParse({ pageSize: '50' }).success).toBe(false);
  });

  it('rejette un salaire minimum hors bornes', () => {
    expect(jobSearchQuerySchema.safeParse({ salaryMin: '2000000' }).success).toBe(false);
  });

  it('rejette une valeur de publishedWithinDays non autorisee', () => {
    expect(jobSearchQuerySchema.safeParse({ publishedWithinDays: '2' }).success).toBe(false);
  });

  it('accepte les valeurs autorisees de publishedWithinDays', () => {
    for (const value of [1, 3, 7, 14, 31]) {
      const result = jobSearchQuerySchema.safeParse({ publishedWithinDays: String(value) });
      expect(result.success).toBe(true);
    }
  });
});

describe('jobSearchQuerySchema — refresh', () => {
  it('convertit "1" et "true" en booleen vrai', () => {
    expect(jobSearchQuerySchema.parse({ refresh: '1' }).refresh).toBe(true);
    expect(jobSearchQuerySchema.parse({ refresh: 'true' }).refresh).toBe(true);
  });

  it('accepte directement un booleen', () => {
    expect(jobSearchQuerySchema.parse({ refresh: true }).refresh).toBe(true);
    expect(jobSearchQuerySchema.parse({ refresh: false }).refresh).toBe(false);
  });

  it('renvoie faux pour toute autre valeur ou une absence', () => {
    expect(jobSearchQuerySchema.parse({ refresh: 'oui' }).refresh).toBe(false);
    expect(jobSearchQuerySchema.parse({}).refresh).toBe(false);
  });
});

describe('jobSearchQuerySchema — cles inconnues', () => {
  it('retire les cles inconnues du resultat', () => {
    const result = jobSearchQuerySchema.parse({ inconnue: 'valeur', q: 'dev' });
    expect(result).not.toHaveProperty('inconnue');
    expect(result.q).toBe('dev');
  });
});

describe('libelles francais', () => {
  it('couvre chaque valeur de ContractType', () => {
    expect(Object.keys(CONTRACT_TYPE_LABELS).sort()).toEqual([...contractTypeSchema.options].sort());
  });

  it('couvre chaque valeur de RemoteMode', () => {
    expect(Object.keys(REMOTE_MODE_LABELS).sort()).toEqual([...remoteModeSchema.options].sort());
  });

  it('couvre chaque valeur de ExperienceLevel', () => {
    expect(Object.keys(EXPERIENCE_LEVEL_LABELS).sort()).toEqual([...experienceLevelSchema.options].sort());
  });

  it('couvre chaque valeur de JobSourceKind', () => {
    expect(Object.keys(JOB_SOURCE_LABELS).sort()).toEqual([...JOB_SOURCE_KINDS].sort());
  });

  it('propose une option par valeur de publishedWithinDays', () => {
    expect(PUBLISHED_WITHIN_OPTIONS.map((option) => option.value).sort((a, b) => a - b)).toEqual([
      1, 3, 7, 14, 31,
    ]);
  });

  it('couvre chaque valeur de tri et d onglet', () => {
    expect(JOB_SORT_VALUES).toEqual(['recent', 'salary']);
    expect(JOB_TAB_VALUES).toEqual(['all', 'new']);
  });
});
