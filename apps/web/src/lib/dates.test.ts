import { describe, expect, it } from 'vitest';
import { formatMonthYear } from './dates';

describe('formatMonthYear', () => {
  it('formate une date AAAA-MM-JJ en mois abrege et annee', () => {
    expect(formatMonthYear('2024-01-01')).toBe('janv. 2024');
  });
});
