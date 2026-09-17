import { describe, expect, it } from 'vitest';
import { SYNONYM_GROUPS, SYNONYMS_VERSION } from './synonyms';

describe('SYNONYM_GROUPS', () => {
  it('contient au moins 60 entrees au total', () => {
    const total = SYNONYM_GROUPS.reduce((sum, group) => sum + group.length, 0);
    expect(total).toBeGreaterThanOrEqual(60);
  });

  it('ne contient aucun groupe vide', () => {
    expect(SYNONYM_GROUPS.every((group) => group.length > 0)).toBe(true);
  });

  it('expose une version numerique', () => {
    expect(typeof SYNONYMS_VERSION).toBe('number');
    expect(SYNONYMS_VERSION).toBeGreaterThanOrEqual(1);
  });
});
