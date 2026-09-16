import { describe, expect, it } from 'vitest';
import { computeQueryHash } from './query-hash';

describe('computeQueryHash', () => {
  it('est independant de l ordre des communes', () => {
    const a = computeQueryHash({ q: 'dev', communes: ['57463', '75056'], distance: 10, contractTypes: [] });
    const b = computeQueryHash({ q: 'dev', communes: ['75056', '57463'], distance: 10, contractTypes: [] });
    expect(a).toBe(b);
  });

  it('est independant de la casse et des espaces de bord de q', () => {
    const a = computeQueryHash({ q: 'Développeur', communes: [], distance: 10, contractTypes: [] });
    const b = computeQueryHash({ q: '  développeur  ', communes: [], distance: 10, contractTypes: [] });
    expect(a).toBe(b);
  });

  it('est independant de l ordre des types de contrat', () => {
    const a = computeQueryHash({ q: '', communes: [], distance: 10, contractTypes: ['CDI', 'CDD'] });
    const b = computeQueryHash({ q: '', communes: [], distance: 10, contractTypes: ['CDD', 'CDI'] });
    expect(a).toBe(b);
  });

  it('differe si le mot cle change', () => {
    const a = computeQueryHash({ q: 'dev', communes: [], distance: 10, contractTypes: [] });
    const b = computeQueryHash({ q: 'devops', communes: [], distance: 10, contractTypes: [] });
    expect(a).not.toBe(b);
  });

  it('differe si la distance change', () => {
    const a = computeQueryHash({ q: '', communes: ['75056'], distance: 10, contractTypes: [] });
    const b = computeQueryHash({ q: '', communes: ['75056'], distance: 25, contractTypes: [] });
    expect(a).not.toBe(b);
  });

  it('differe si les communes changent', () => {
    const a = computeQueryHash({ q: '', communes: ['75056'], distance: 10, contractTypes: [] });
    const b = computeQueryHash({ q: '', communes: ['57463'], distance: 10, contractTypes: [] });
    expect(a).not.toBe(b);
  });
});
