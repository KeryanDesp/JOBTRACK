import { describe, expect, it } from 'vitest';
import {
  certificationSchema,
  educationSchema,
  experienceSchema,
  jobPreferencesSchema,
  profileSchema,
  projectSchema,
  reorderSchema,
} from './profile';

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

describe('educationSchema', () => {
  it('refuse une date de fin anterieure au debut', () => {
    const result = educationSchema.safeParse({
      school: 'Universite',
      degree: 'Master',
      startDate: '2024-01-01',
      endDate: '2023-01-01',
    });
    expect(result.success).toBe(false);
    if (!result.success) expect(result.error.issues[0]?.path).toEqual(['endDate']);
  });
});

describe('certificationSchema', () => {
  it('refuse une date d_expiration anterieure a l_obtention', () => {
    const result = certificationSchema.safeParse({
      name: 'Certification',
      issuer: 'Editeur',
      issuedAt: '2024-01-01',
      expiresAt: '2023-01-01',
    });
    expect(result.success).toBe(false);
    if (!result.success) expect(result.error.issues[0]?.path).toEqual(['expiresAt']);
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

  it('transforme un nombre vide en null (effacable), jamais en 0, et laisse une cle absente inchangee', () => {
    const cleared = profileSchema.parse({ firstName: 'A', lastName: 'B', yearsExperience: '' });
    expect(cleared.yearsExperience).toBeNull();
    const untouched = profileSchema.parse({ firstName: 'A', lastName: 'B' });
    expect('yearsExperience' in untouched).toBe(false);
  });

  it('convertit une chaine de chiffres en nombre', () => {
    expect(profileSchema.parse({ firstName: 'A', lastName: 'B', yearsExperience: '12' }).yearsExperience).toBe(12);
  });

  it('accepte zero', () => {
    expect(profileSchema.parse({ firstName: 'A', lastName: 'B', yearsExperience: 0 }).yearsExperience).toBe(0);
  });

  it('refuse null, un booleen ou un tableau : plus de coercion implicite (z.coerce transformait true/false/[] en 1/0)', () => {
    expect(profileSchema.safeParse({ firstName: 'A', lastName: 'B', yearsExperience: null }).success).toBe(false);
    expect(profileSchema.safeParse({ firstName: 'A', lastName: 'B', yearsExperience: true }).success).toBe(false);
    expect(profileSchema.safeParse({ firstName: 'A', lastName: 'B', yearsExperience: [] }).success).toBe(false);
  });

  it('transforme un texte vide en null et laisse une cle absente inchangee', () => {
    const cleared = profileSchema.parse({ firstName: 'A', lastName: 'B', phone: '   ' });
    expect(cleared.phone).toBeNull();
    const untouched = profileSchema.parse({ firstName: 'A', lastName: 'B' });
    expect('phone' in untouched).toBe(false);
  });
});

describe('optionalUrl (via projectSchema.url)', () => {
  it('refuse un protocole non http(s), meme syntaxiquement valide pour new URL()', () => {
    const result = projectSchema.safeParse({ name: 'X', url: 'javascript:alert(1)' });
    expect(result.success).toBe(false);
  });

  it('accepte une url http(s)', () => {
    expect(projectSchema.parse({ name: 'X', url: 'https://x.y' }).url).toBe('https://x.y');
  });

  it('efface un champ url vide et laisse une cle absente inchangee', () => {
    expect(projectSchema.parse({ name: 'X', url: '' }).url).toBeNull();
    expect(projectSchema.parse({ name: 'X' }).url).toBeUndefined();
  });
});

describe('jobPreferencesSchema', () => {
  const base = { desiredRoles: [], desiredCategories: [], locations: [], remoteModes: [], contractTypes: [] };

  it('refuse un salaire minimum superieur au maximum', () => {
    const result = jobPreferencesSchema.safeParse({ ...base, salaryMin: 60000, salaryMax: 40000 });
    expect(result.success).toBe(false);
  });

  // Anciennement : « applique 25 km par defaut au rayon, y compris pour un champ vide »
  // (Task 2). Decision inversee ici : un PATCH partiel ne doit jamais reinitialiser une
  // valeur deja enregistree. Le defaut (25, comme 'EUR' pour la devise) ne vit plus que
  // dans la colonne Prisma (`@default`), jamais dans ce schema.
  it('ne force plus 25 km par defaut : une cle absente reste absente, inchangee', () => {
    const parsed = jobPreferencesSchema.parse(base);
    expect('searchRadiusKm' in parsed).toBe(false);
  });

  it('une chaine vide efface desormais le rayon (comme les autres champs numeriques), sans retomber sur 25', () => {
    expect(jobPreferencesSchema.parse({ ...base, searchRadiusKm: '' }).searchRadiusKm).toBeNull();
  });

  it('ne force plus EUR par defaut sur la devise : une cle absente reste absente, inchangee', () => {
    const parsed = jobPreferencesSchema.parse(base);
    expect('currency' in parsed).toBe(false);
  });
});

describe('reorderSchema', () => {
  it('refuse une liste vide ou des identifiants non cuid', () => {
    expect(reorderSchema.safeParse({ ids: [] }).success).toBe(false);
    expect(reorderSchema.safeParse({ ids: ['pas-un-cuid'] }).success).toBe(false);
  });

  it('refuse plus de 100 identifiants', () => {
    const ids = Array.from({ length: 101 }, (_, i) => `c${i.toString().padStart(24, '0')}`);
    expect(reorderSchema.safeParse({ ids }).success).toBe(false);
  });

  it('accepte jusqu_a 100 identifiants uniques', () => {
    const ids = Array.from({ length: 100 }, (_, i) => `c${i.toString().padStart(24, '0')}`);
    expect(reorderSchema.safeParse({ ids }).success).toBe(true);
  });

  it('refuse des identifiants en double', () => {
    const id = 'c123456789012345678901234';
    const result = reorderSchema.safeParse({ ids: [id, id] });
    expect(result.success).toBe(false);
    if (!result.success) expect(result.error.issues[0]?.message).toBe('Identifiants en double.');
  });
});
