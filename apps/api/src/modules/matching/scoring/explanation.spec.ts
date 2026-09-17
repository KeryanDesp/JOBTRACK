import { describe, expect, it } from 'vitest';
import type { MatchFactorDto } from '@jobtrack/shared';
import { buildExplanation } from './explanation';

const NOW = new Date('2026-09-17T12:00:00.000Z');

function factor(overrides: Partial<MatchFactorDto>): MatchFactorDto {
  return {
    key: 'skills',
    label: 'Compétences et technologies',
    weight: 35,
    score: 50,
    status: 'evaluated',
    evidence: [],
    ...overrides,
  };
}

describe('buildExplanation', () => {
  it('reprend jusqu_a 3 lignes ok des facteurs les mieux notes', () => {
    const factors: MatchFactorDto[] = [
      factor({ key: 'skills', weight: 35, score: 90, evidence: [{ kind: 'ok', text: 'Skills ok' }] }),
      factor({ key: 'experience', weight: 15, score: 80, evidence: [{ kind: 'ok', text: 'Experience ok' }] }),
      factor({ key: 'location', weight: 15, score: 70, evidence: [{ kind: 'ok', text: 'Location ok' }] }),
      factor({ key: 'salary', weight: 10, score: 60, evidence: [{ kind: 'ok', text: 'Salary ok' }] }),
    ];
    const explanation = buildExplanation(factors, new Date('2020-01-01'), NOW);
    expect(explanation.top).toEqual(['Skills ok', 'Experience ok', 'Location ok']);
  });

  it('ajoute Publiee aujourd_hui quand l_offre a moins de 24h, meme au-dela de 3 lignes', () => {
    const factors: MatchFactorDto[] = [
      factor({ key: 'skills', weight: 35, score: 90, evidence: [{ kind: 'ok', text: 'Skills ok' }] }),
      factor({ key: 'experience', weight: 15, score: 80, evidence: [{ kind: 'ok', text: 'Experience ok' }] }),
      factor({ key: 'location', weight: 15, score: 70, evidence: [{ kind: 'ok', text: 'Location ok' }] }),
    ];
    const publishedAt = new Date(NOW.getTime() - 3 * 60 * 60 * 1000);
    const explanation = buildExplanation(factors, publishedAt, NOW);
    expect(explanation.top).toHaveLength(4);
    expect(explanation.top[3]).toBe('Publiée aujourd\'hui');
  });

  it('n_ajoute pas Publiee aujourd_hui pour une offre plus ancienne que 24h', () => {
    const factors: MatchFactorDto[] = [
      factor({ key: 'skills', weight: 35, score: 90, evidence: [{ kind: 'ok', text: 'Skills ok' }] }),
    ];
    const publishedAt = new Date(NOW.getTime() - 48 * 60 * 60 * 1000);
    const explanation = buildExplanation(factors, publishedAt, NOW);
    expect(explanation.top).toEqual(['Skills ok']);
  });

  it('reprend jusqu_a 2 lignes missing/warn des facteurs les moins bien notes', () => {
    const factors: MatchFactorDto[] = [
      factor({ key: 'skills', weight: 35, score: 20, evidence: [{ kind: 'missing', text: 'Skills manquant' }] }),
      factor({ key: 'experience', weight: 15, score: 30, evidence: [{ kind: 'warn', text: 'Experience faible' }] }),
      factor({ key: 'location', weight: 15, score: 40, evidence: [{ kind: 'warn', text: 'Location faible' }] }),
    ];
    const explanation = buildExplanation(factors, new Date('2020-01-01'), NOW);
    expect(explanation.weak).toEqual(['Skills manquant', 'Experience faible']);
  });

  it('ignore les facteurs unknown', () => {
    const factors: MatchFactorDto[] = [
      factor({ key: 'skills', status: 'unknown', score: null, evidence: [{ kind: 'info', text: 'Inconnu' }] }),
    ];
    const explanation = buildExplanation(factors, new Date('2020-01-01'), NOW);
    expect(explanation.top).toEqual([]);
    expect(explanation.weak).toEqual([]);
  });
});
