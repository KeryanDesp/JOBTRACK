import { describe, expect, it } from 'vitest';
import { formatLocation, formatRelativeTime, formatSalaryRange } from './format';

const NOW = new Date('2026-09-16T12:00:00.000Z');

function isoBefore(ms: number): string {
  return new Date(NOW.getTime() - ms).toISOString();
}

describe('formatRelativeTime', () => {
  it('affiche a l_instant sous 60 secondes', () => {
    expect(formatRelativeTime(isoBefore(30_000), NOW)).toBe("à l'instant");
  });

  it('affiche des minutes entre 1 minute et 1 heure', () => {
    expect(formatRelativeTime(isoBefore(5 * 60_000), NOW)).toBe('il y a 5 minutes');
  });

  it('affiche des heures entre 1 heure et 1 jour', () => {
    expect(formatRelativeTime(isoBefore(2 * 3_600_000), NOW)).toBe('il y a 2 heures');
  });

  it('affiche hier a exactement 24 heures', () => {
    expect(formatRelativeTime(isoBefore(24 * 3_600_000), NOW)).toBe('hier');
  });

  it('affiche des jours entre 1 et 7 jours', () => {
    expect(formatRelativeTime(isoBefore(3 * 24 * 3_600_000), NOW)).toBe('il y a 3 jours');
  });

  it('affiche des semaines entre 1 et 4 semaines', () => {
    expect(formatRelativeTime(isoBefore(14 * 24 * 3_600_000), NOW)).toBe('il y a 2 semaines');
  });

  it('affiche des mois au dela de 4 semaines', () => {
    expect(formatRelativeTime(isoBefore(90 * 24 * 3_600_000), NOW)).toBe('il y a 3 mois');
  });

  it('utilise l_heure courante quand now n_est pas fourni', () => {
    expect(formatRelativeTime(new Date().toISOString())).toBe("à l'instant");
  });
});

describe('formatSalaryRange', () => {
  it('renvoie null quand les deux bornes sont nulles', () => {
    expect(formatSalaryRange(null, null)).toBeNull();
  });

  it('formate une fourchette en milliers arrondis avec un tiret demi-cadratin', () => {
    expect(formatSalaryRange(45_000, 70_000)).toBe('45–70 k€');
  });

  it('formate un minimum seul avec a partir de', () => {
    expect(formatSalaryRange(30_000, null)).toBe('à partir de 30 k€');
  });

  it('formate un maximum seul avec jusqu_a', () => {
    expect(formatSalaryRange(null, 40_000)).toBe("jusqu'à 40 k€");
  });

  it('affiche un montant brut sous 1000 sans reduction en milliers', () => {
    expect(formatSalaryRange(null, 800)).toBe('jusqu\'à 800 €');
  });

  it('arrondit les milliers non ronds', () => {
    expect(formatSalaryRange(45_500, null)).toBe('à partir de 46 k€');
  });

  it('utilise le code de la devise quand elle n_est pas EUR', () => {
    expect(formatSalaryRange(45_000, 70_000, 'USD')).toBe('45–70 kUSD');
  });
});

describe('formatLocation', () => {
  it('renvoie le libelle quand il est fourni', () => {
    expect(formatLocation('Metz (57)', '57')).toBe('Metz (57)');
  });

  it('retombe sur le departement quand le libelle est absent', () => {
    expect(formatLocation(null, '57')).toBe('Département 57');
  });

  it('renvoie un libelle generique sans libelle ni departement', () => {
    expect(formatLocation(null, null)).toBe('Lieu non précisé');
  });

  it('retombe sur le departement quand le libelle est une chaine vide', () => {
    expect(formatLocation('', '75')).toBe('Département 75');
  });
});
