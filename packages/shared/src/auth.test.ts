import { describe, expect, it } from 'vitest';
import { loginSchema, registerSchema } from './auth';

describe('registerSchema', () => {
  const valid = {
    email: 'Keryan@Example.COM',
    password: 'motdepasse-solide-2026',
    firstName: 'Keryan',
    lastName: 'Desplan',
  };

  it('accepte une inscription valide et normalise l_email en minuscules', () => {
    expect(registerSchema.parse(valid).email).toBe('keryan@example.com');
  });

  it('refuse un mot de passe de moins de 12 caracteres', () => {
    expect(registerSchema.safeParse({ ...valid, password: 'court123' }).success).toBe(false);
  });

  it('refuse un email malforme', () => {
    expect(registerSchema.safeParse({ ...valid, email: 'pas-un-email' }).success).toBe(false);
  });

  it('refuse un prenom vide', () => {
    expect(registerSchema.safeParse({ ...valid, firstName: '   ' }).success).toBe(false);
  });
});

describe('loginSchema', () => {
  it('n_impose pas la longueur minimale au mot de passe', () => {
    // Les règles de robustesse s'appliquent à la création, pas à la connexion :
    // un ancien compte doit pouvoir se connecter.
    const result = loginSchema.safeParse({ email: 'a@b.com', password: 'x' });
    expect(result.success).toBe(true);
  });

  it('refuse un mot de passe de connexion de plus de 128 caracteres', () => {
    const result = loginSchema.safeParse({ email: 'a@b.com', password: 'x'.repeat(129) });
    expect(result.success).toBe(false);
  });
});
