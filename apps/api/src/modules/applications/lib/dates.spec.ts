import { describe, expect, it } from 'vitest';
import { parseIsoDate, startOfWeekUtc, todayUtc, toIsoDate } from './dates';

/**
 * Ces cas passent une reference explicite (`now`) : ils ne dependent donc ni du fuseau de la
 * machine qui les execute, ni de l_heure a laquelle la suite tourne. Chacun est choisi dans la
 * fenetre ou Paris et UTC ne sont **pas** le meme jour — la seule ou l_ancien calcul en UTC
 * donnait une date fausse.
 */
describe('todayUtc', () => {
  it('rend le jour parisien, pas le jour UTC, en heure d_ete', () => {
    // 22 h 30 UTC le 17 = 00 h 30 le 18 a Paris (UTC+2).
    expect(toIsoDate(todayUtc(new Date('2026-09-17T22:30:00.000Z')))).toBe('2026-09-18');
  });

  it('rend le jour parisien en heure d_hiver', () => {
    // 23 h 30 UTC le 15 = 00 h 30 le 16 a Paris (UTC+1).
    expect(toIsoDate(todayUtc(new Date('2026-01-15T23:30:00.000Z')))).toBe('2026-01-16');
  });

  it('rend le meme jour quand Paris et UTC sont d_accord', () => {
    expect(toIsoDate(todayUtc(new Date('2026-09-17T10:00:00.000Z')))).toBe('2026-09-17');
  });

  it('rend toujours minuit UTC : un jour stocke n_a jamais d_heure', () => {
    expect(todayUtc(new Date('2026-09-17T22:30:00.000Z')).toISOString()).toBe('2026-09-18T00:00:00.000Z');
  });
});

describe('startOfWeekUtc', () => {
  it('commence la semaine le lundi', () => {
    expect(toIsoDate(startOfWeekUtc(new Date('2026-09-17T10:00:00.000Z')))).toBe('2026-09-14');
  });

  it('bascule des que le lundi commence a Paris, pas deux heures plus tard', () => {
    // 22 h 30 UTC le dimanche 13 = 00 h 30 le lundi 14 a Paris : la semaine a deja change.
    expect(toIsoDate(startOfWeekUtc(new Date('2026-09-13T22:30:00.000Z')))).toBe('2026-09-14');
  });

  it('garde le dimanche dans la semaine qui s_acheve', () => {
    expect(toIsoDate(startOfWeekUtc(new Date('2026-09-13T12:00:00.000Z')))).toBe('2026-09-07');
  });
});

describe('parseIsoDate', () => {
  it('pose minuit UTC et reste stable par aller-retour', () => {
    expect(parseIsoDate('2026-09-14').toISOString()).toBe('2026-09-14T00:00:00.000Z');
    expect(toIsoDate(parseIsoDate('2026-09-14'))).toBe('2026-09-14');
  });
});
