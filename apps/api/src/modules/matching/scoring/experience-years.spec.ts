import { describe, expect, it } from 'vitest';
import { computeExperienceYears } from './experience-years';

const NOW = new Date('2026-09-17T00:00:00.000Z');

describe('computeExperienceYears', () => {
  it('renvoie 0 sans experience', () => {
    expect(computeExperienceYears([], NOW)).toBe(0);
  });

  it('calcule la duree d_une seule experience terminee', () => {
    const years = computeExperienceYears(
      [{ startDate: new Date('2020-01-01'), endDate: new Date('2023-01-01'), isCurrent: false }],
      NOW,
    );
    expect(years).toBeCloseTo(3, 1);
  });

  it('prolonge jusqu_a aujourd_hui une experience en cours', () => {
    const years = computeExperienceYears(
      [{ startDate: new Date('2024-09-17'), endDate: null, isCurrent: true }],
      NOW,
    );
    expect(years).toBeCloseTo(2, 1);
  });

  it('fusionne deux experiences qui se chevauchent sans compter deux fois', () => {
    const years = computeExperienceYears(
      [
        { startDate: new Date('2020-01-01'), endDate: new Date('2022-01-01'), isCurrent: false },
        { startDate: new Date('2021-01-01'), endDate: new Date('2023-01-01'), isCurrent: false },
      ],
      NOW,
    );
    // Union du 2020-01-01 au 2023-01-01, soit 3 ans, pas 4 (2 + 2).
    expect(years).toBeCloseTo(3, 1);
  });

  it('additionne deux experiences disjointes', () => {
    const years = computeExperienceYears(
      [
        { startDate: new Date('2018-01-01'), endDate: new Date('2019-01-01'), isCurrent: false },
        { startDate: new Date('2021-01-01'), endDate: new Date('2022-01-01'), isCurrent: false },
      ],
      NOW,
    );
    expect(years).toBeCloseTo(2, 1);
  });

  it('arrondit le resultat au dixieme', () => {
    const years = computeExperienceYears(
      [{ startDate: new Date('2024-01-01'), endDate: new Date('2024-04-02'), isCurrent: false }],
      NOW,
    );
    expect(Number.isInteger(years * 10)).toBe(true);
  });

  it('ignore un intervalle degenere (fin avant ou egale au debut)', () => {
    const years = computeExperienceYears(
      [{ startDate: new Date('2024-01-01'), endDate: new Date('2023-01-01'), isCurrent: false }],
      NOW,
    );
    expect(years).toBe(0);
  });

  it('borne une date de fin future a aujourd_hui, sans gonfler l_experience', () => {
    const withFutureEnd = computeExperienceYears(
      [{ startDate: new Date('2024-09-17'), endDate: new Date('2030-09-17'), isCurrent: false }],
      NOW,
    );
    const withTodayEnd = computeExperienceYears(
      [{ startDate: new Date('2024-09-17'), endDate: NOW, isCurrent: false }],
      NOW,
    );
    expect(withFutureEnd).toBe(withTodayEnd);
    expect(withFutureEnd).toBeCloseTo(2, 1);
  });
});
