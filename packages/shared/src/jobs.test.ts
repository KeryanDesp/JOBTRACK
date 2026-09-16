import { describe, expect, it } from 'vitest';
import {
  CONTRACT_TYPE_LABELS,
  EXPERIENCE_LEVEL_LABELS,
  JOB_REQUIREMENT_KIND_LABELS,
  JOB_SEARCH_PARAM_KEYS,
  JOB_SOURCE_KINDS,
  JOB_SOURCE_LABELS,
  JOB_TABS,
  JOB_SORT_OPTIONS,
  PUBLISHED_WITHIN_DAYS_VALUES,
  PUBLISHED_WITHIN_OPTIONS,
  REMOTE_MODE_LABELS,
  jobRequirementKindSchema,
  jobSearchQuerySchema,
  jobSortSchema,
  jobTabSchema,
  parseJobSearchParams,
  toJobSearchParams,
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

  it('reste stable en re-validant sa propre sortie (round trip)', () => {
    const defaults = jobSearchQuerySchema.parse({});
    expect(jobSearchQuerySchema.parse(defaults)).toEqual(defaults);
  });

  it('accepte des champs numeriques valant zero', () => {
    const result = jobSearchQuerySchema.safeParse({ page: 2, distance: 0 });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.page).toBe(2);
      expect(result.data.distance).toBe(0);
    }
  });
});

describe('jobSearchQuerySchema — champs tableau', () => {
  it('regroupe les cles repetees en tableau (cle courte "contrat")', () => {
    const params = new URLSearchParams();
    params.append('contrat', 'CDI');
    params.append('contrat', 'CDD');
    const result = parseJobSearchParams(params);
    expect(result.contractTypes).toEqual(['CDI', 'CDD']);
  });

  it('accepte des valeurs separees par des virgules', () => {
    const params = new URLSearchParams({ contrat: 'CDI,CDD' });
    const result = parseJobSearchParams(params);
    expect(result.contractTypes).toEqual(['CDI', 'CDD']);
  });

  it('dedoublonne les valeurs repetees', () => {
    const params = new URLSearchParams({ contrat: 'CDI,CDI,CDD' });
    const result = parseJobSearchParams(params);
    expect(result.contractTypes).toEqual(['CDI', 'CDD']);
  });

  it('accepte le mode de teletravail via la cle courte "remote"', () => {
    const params = new URLSearchParams({ remote: 'HYBRID,REMOTE,HYBRID' });
    const result = parseJobSearchParams(params);
    expect(result.remoteModes).toEqual(['HYBRID', 'REMOTE']);
  });

  it('accepte le niveau d experience via la cle courte "exp"', () => {
    const params = new URLSearchParams();
    params.append('exp', 'JUNIOR');
    params.append('exp', 'SENIOR');
    const result = parseJobSearchParams(params);
    expect(result.experienceLevels).toEqual(['JUNIOR', 'SENIOR']);
  });

  it('accepte les sources via la cle courte "source"', () => {
    const params = new URLSearchParams({ source: 'FRANCE_TRAVAIL,FRANCE_TRAVAIL' });
    const result = parseJobSearchParams(params);
    expect(result.sources).toEqual(['FRANCE_TRAVAIL']);
  });

  it('dedoublonne les communes (cle courte "lieu")', () => {
    const params = new URLSearchParams({ lieu: '75001,75001,69001' });
    const result = parseJobSearchParams(params);
    expect(result.communes).toEqual(['75001', '69001']);
  });

  it('accepte un code commune corse (2A/2B)', () => {
    const result = jobSearchQuerySchema.safeParse({ communes: '2A004' });
    expect(result.success).toBe(true);
    if (result.success) expect(result.data.communes).toEqual(['2A004']);
  });
});

describe('jobSearchQuerySchema — validation', () => {
  it('rejette une recherche libre trop longue', () => {
    expect(jobSearchQuerySchema.safeParse({ q: 'a'.repeat(121) }).success).toBe(false);
  });

  it('rejette un code commune invalide en safeParse', () => {
    const result = jobSearchQuerySchema.safeParse({ communes: 'abcde' });
    expect(result.success).toBe(false);
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
    for (const value of PUBLISHED_WITHIN_DAYS_VALUES) {
      const result = jobSearchQuerySchema.safeParse({ publishedWithinDays: String(value) });
      expect(result.success).toBe(true);
    }
  });
});

describe('jobSearchQuerySchema — reprise sur chaine vide', () => {
  it('applique le defaut quand distance est une chaine vide', () => {
    expect(jobSearchQuerySchema.parse({ distance: '' }).distance).toBe(10);
  });

  it('applique le defaut quand sort est une chaine vide', () => {
    expect(jobSearchQuerySchema.parse({ sort: '' }).sort).toBe('recent');
  });

  it('applique le defaut quand page est une chaine vide', () => {
    expect(jobSearchQuerySchema.parse({ page: '' }).page).toBe(1);
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

  it('ignore une cle courte d URL inconnue', () => {
    const params = new URLSearchParams({ inconnue: 'valeur', q: 'dev' });
    const result = parseJobSearchParams(params);
    expect(result.q).toBe('dev');
  });
});

describe('parseJobSearchParams — repli champ par champ', () => {
  it('conserve les champs valides et retombe sur le defaut du seul champ invalide', () => {
    const params = new URLSearchParams({ q: 'developpeur', page: '0' });
    const result = parseJobSearchParams(params);
    expect(result.q).toBe('developpeur');
    expect(result.page).toBe(1);
  });

  it('corrige plusieurs champs invalides en une seule reprise', () => {
    const params = new URLSearchParams({ q: 'developpeur', lieu: 'abcde', page: '0' });
    const result = parseJobSearchParams(params);
    expect(result.q).toBe('developpeur');
    expect(result.communes).toEqual([]);
    expect(result.page).toBe(1);
  });
});

describe('toJobSearchParams', () => {
  it('omet les valeurs par defaut', () => {
    const params = toJobSearchParams(jobSearchQuerySchema.parse({}));
    expect(params.toString()).toBe('');
  });

  it('ecrit les cles courtes et joint les tableaux par des virgules', () => {
    const query = jobSearchQuerySchema.parse({
      q: 'developpeur',
      communes: ['75001', '69001'],
      contractTypes: ['CDI', 'CDD'],
      page: 2,
    });
    const params = toJobSearchParams(query);
    expect(params.get(JOB_SEARCH_PARAM_KEYS.q)).toBe('developpeur');
    expect(params.get(JOB_SEARCH_PARAM_KEYS.communes)).toBe('75001,69001');
    expect(params.get(JOB_SEARCH_PARAM_KEYS.contractTypes)).toBe('CDI,CDD');
    expect(params.get(JOB_SEARCH_PARAM_KEYS.page)).toBe('2');
    expect(params.has(JOB_SEARCH_PARAM_KEYS.distance)).toBe(false);
  });

  it('fait un aller-retour stable avec parseJobSearchParams', () => {
    const original = new URLSearchParams({
      q: 'developpeur',
      lieu: '75001,69001',
      rayon: '20',
      contrat: 'CDI,CDD',
      page: '2',
    });
    const query = parseJobSearchParams(original);
    const reparsed = parseJobSearchParams(toJobSearchParams(query));
    expect(reparsed).toEqual(query);
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

  it('couvre chaque valeur de JobRequirementKind', () => {
    expect(Object.keys(JOB_REQUIREMENT_KIND_LABELS).sort()).toEqual([...jobRequirementKindSchema.options].sort());
  });

  it('propose une option par valeur de publishedWithinDays', () => {
    expect(PUBLISHED_WITHIN_OPTIONS.map((option) => option.value).sort((a, b) => a - b)).toEqual([
      ...PUBLISHED_WITHIN_DAYS_VALUES,
    ]);
  });

  it('propose une option de tri par valeur de JobSort', () => {
    expect(JOB_SORT_OPTIONS.map((option) => option.value).sort()).toEqual([...jobSortSchema.options].sort());
  });

  it('propose un onglet par valeur de JobTab', () => {
    expect(JOB_TABS.map((option) => option.value).sort()).toEqual([...jobTabSchema.options].sort());
  });
});
