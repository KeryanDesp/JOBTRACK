import { describe, expect, it } from 'vitest';
import { baseProfile } from './testing/fixtures';
import { profileFingerprint } from './fingerprint';

describe('profileFingerprint', () => {
  it('est stable pour les memes entrees', () => {
    const profile = baseProfile({ skills: [{ name: 'React', level: 'ADVANCED' }] });
    expect(profileFingerprint(profile)).toBe(profileFingerprint(profile));
  });

  it('est insensible a l_ordre des tableaux', () => {
    const a = baseProfile({
      skills: [
        { name: 'React', level: 'ADVANCED' },
        { name: 'Node', level: 'INTERMEDIATE' },
      ],
    });
    const b = baseProfile({
      skills: [
        { name: 'Node', level: 'INTERMEDIATE' },
        { name: 'React', level: 'ADVANCED' },
      ],
    });
    expect(profileFingerprint(a)).toBe(profileFingerprint(b));
  });

  it('change quand une competence change', () => {
    const a = baseProfile({ skills: [{ name: 'React', level: 'ADVANCED' }] });
    const b = baseProfile({ skills: [{ name: 'Vue', level: 'ADVANCED' }] });
    expect(profileFingerprint(a)).not.toBe(profileFingerprint(b));
  });

  it('change quand le niveau d_une competence change', () => {
    const a = baseProfile({ skills: [{ name: 'React', level: 'ADVANCED' }] });
    const b = baseProfile({ skills: [{ name: 'React', level: 'BEGINNER' }] });
    expect(profileFingerprint(a)).not.toBe(profileFingerprint(b));
  });

  it('renvoie une chaine hexadecimale de 64 caracteres (sha256)', () => {
    expect(profileFingerprint(baseProfile())).toMatch(/^[0-9a-f]{64}$/);
  });
});
