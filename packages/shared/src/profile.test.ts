import { describe, expect, it } from 'vitest';
import { experienceSchema, profileSchema, reorderSchema } from './profile';

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
});

describe('profileSchema', () => {
  it('convertit les annees d_experience saisies en texte', () => {
    const parsed = profileSchema.parse({ firstName: 'A', lastName: 'B', yearsExperience: '3' });
    expect(parsed.yearsExperience).toBe(3);
  });

  it('accepte une chaine vide pour un champ optionnel', () => {
    expect(profileSchema.safeParse({ firstName: 'A', lastName: 'B', phone: '' }).success).toBe(true);
  });
});

describe('reorderSchema', () => {
  it('refuse une liste vide ou des identifiants non cuid', () => {
    expect(reorderSchema.safeParse({ ids: [] }).success).toBe(false);
    expect(reorderSchema.safeParse({ ids: ['pas-un-cuid'] }).success).toBe(false);
  });
});
