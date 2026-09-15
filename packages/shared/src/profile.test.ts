import { describe, expect, it } from 'vitest';
import { experienceSchema, jobPreferencesSchema, profileSchema, reorderSchema } from './profile';

describe('experienceSchema', () => {
  const base = { company: 'Acme', role: 'Dev', startDate: '2023-09-01' };

  it('accepte un poste actuel sans date de fin', () => {
    expect(experienceSchema.safeParse({ ...base, isCurrent: true }).success).toBe(true);
  });

  it('exige une date de fin quand le poste n_est pas actuel', () => {
    const result = experienceSchema.safeParse({ ...base, isCurrent: false });
    expect(result.success).toBe(false);
    if (!result.success) expect(result.error.issues[0]?.path).toEqual(['endDate']);
  });

  it('n_accepte que des dates calendaires AAAA-MM-JJ', () => {
    expect(experienceSchema.safeParse({ ...base, isCurrent: true, startDate: '2023-09-01T10:00:00Z' }).success).toBe(false);
    expect(experienceSchema.safeParse({ ...base, isCurrent: true, startDate: '01/09/2023' }).success).toBe(false);
  });

  it('refuse une date de fin anterieure au debut', () => {
    const result = experienceSchema.safeParse({ ...base, startDate: '2024-01-01', endDate: '2023-01-01' });
    expect(result.success).toBe(false);
  });

  it('efface la date de fin d_un poste actuel', () => {
    expect(experienceSchema.parse({ ...base, isCurrent: true, endDate: '2024-01-01' }).endDate).toBeNull();
  });
});

describe('profileSchema', () => {
  it('convertit les annees d_experience saisies en texte', () => {
    const parsed = profileSchema.parse({ firstName: 'A', lastName: 'B', yearsExperience: '3' });
    expect(parsed.yearsExperience).toBe(3);
  });

  it('accepte une chaine vide pour un champ optionnel', () => {
    expect(profileSchema.safeParse({ firstName: 'A', lastName: 'B', phone: '' }).success).toBe(true);
  });

  it('transforme un nombre vide en undefined, jamais en 0', () => {
    const parsed = profileSchema.parse({ firstName: 'A', lastName: 'B', yearsExperience: '' });
    expect(parsed.yearsExperience).toBeUndefined();
    expect('yearsExperience' in parsed).toBe(false);
  });

  it('transforme un texte vide en null et laisse une cle absente inchangee', () => {
    const cleared = profileSchema.parse({ firstName: 'A', lastName: 'B', phone: '   ' });
    expect(cleared.phone).toBeNull();
    const untouched = profileSchema.parse({ firstName: 'A', lastName: 'B' });
    expect('phone' in untouched).toBe(false);
  });
});

describe('jobPreferencesSchema', () => {
  const base = { desiredRoles: [], desiredCategories: [], locations: [], remoteModes: [], contractTypes: [] };

  it('refuse un salaire minimum superieur au maximum', () => {
    const result = jobPreferencesSchema.safeParse({ ...base, salaryMin: 60000, salaryMax: 40000 });
    expect(result.success).toBe(false);
  });

  it('applique 25 km par defaut au rayon, y compris pour un champ vide', () => {
    expect(jobPreferencesSchema.parse(base).searchRadiusKm).toBe(25);
    expect(jobPreferencesSchema.parse({ ...base, searchRadiusKm: '' }).searchRadiusKm).toBe(25);
  });
});

describe('reorderSchema', () => {
  it('refuse une liste vide ou des identifiants non cuid', () => {
    expect(reorderSchema.safeParse({ ids: [] }).success).toBe(false);
    expect(reorderSchema.safeParse({ ids: ['pas-un-cuid'] }).success).toBe(false);
  });
});
