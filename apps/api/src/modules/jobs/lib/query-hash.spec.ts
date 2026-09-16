import { describe, expect, it } from 'vitest';
import { buildCanonicalQuery, computeQueryHash } from './query-hash';

describe('computeQueryHash', () => {
  it('est independant de l ordre des communes', () => {
    const a = computeQueryHash({ q: 'dev', communes: ['57463', '75056'], distance: 10, contractCodes: [] });
    const b = computeQueryHash({ q: 'dev', communes: ['75056', '57463'], distance: 10, contractCodes: [] });
    expect(a).toBe(b);
  });

  it('est independant de la casse et des espaces de bord de q', () => {
    const a = computeQueryHash({ q: 'Développeur', communes: [], distance: 10, contractCodes: [] });
    const b = computeQueryHash({ q: '  développeur  ', communes: [], distance: 10, contractCodes: [] });
    expect(a).toBe(b);
  });

  it('est independant de l ordre des codes de contrat', () => {
    const a = computeQueryHash({ q: '', communes: [], distance: 10, contractCodes: ['CDI', 'CDD'] });
    const b = computeQueryHash({ q: '', communes: [], distance: 10, contractCodes: ['CDD', 'CDI'] });
    expect(a).toBe(b);
  });

  it('differe si le mot cle change', () => {
    const a = computeQueryHash({ q: 'dev', communes: [], distance: 10, contractCodes: [] });
    const b = computeQueryHash({ q: 'devops', communes: [], distance: 10, contractCodes: [] });
    expect(a).not.toBe(b);
  });

  it('differe si la distance change avec une commune', () => {
    const a = computeQueryHash({ q: '', communes: ['75056'], distance: 10, contractCodes: [] });
    const b = computeQueryHash({ q: '', communes: ['75056'], distance: 25, contractCodes: [] });
    expect(a).not.toBe(b);
  });

  it('ignore la distance sans commune (recherche nationale)', () => {
    const a = computeQueryHash({ q: '', communes: [], distance: 10, contractCodes: [] });
    const b = computeQueryHash({ q: '', communes: [], distance: 25, contractCodes: [] });
    expect(a).toBe(b);
  });

  it('differe si les communes changent', () => {
    const a = computeQueryHash({ q: '', communes: ['75056'], distance: 10, contractCodes: [] });
    const b = computeQueryHash({ q: '', communes: ['57463'], distance: 10, contractCodes: [] });
    expect(a).not.toBe(b);
  });
});

describe('buildCanonicalQuery', () => {
  it('met la distance a null sans commune', () => {
    expect(buildCanonicalQuery({ q: 'dev', communes: [], distance: 10, contractCodes: [] }).distance).toBeNull();
  });

  it('trie communes et codes de contrat', () => {
    const canonical = buildCanonicalQuery({
      q: 'dev',
      communes: ['75056', '57463'],
      distance: 10,
      contractCodes: ['SAI', 'CDD'],
    });
    expect(canonical.communes).toEqual(['57463', '75056']);
    expect(canonical.contractCodes).toEqual(['CDD', 'SAI']);
  });
});
