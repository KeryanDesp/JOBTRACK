import { describe, expect, it } from 'vitest';
import { parseSalaryLabel } from './salary';

describe('parseSalaryLabel', () => {
  it('mensuel avec fourchette et duree en mois se convertit en annuel', () => {
    expect(parseSalaryLabel('Mensuel de 2500.00 Euros à 3000.00 Euros sur 12.00 mois')).toEqual({
      minAnnual: 30000,
      maxAnnual: 36000,
    });
  });

  it('mensuel avec un seul montant et treize mois se convertit en annuel', () => {
    expect(parseSalaryLabel('Mensuel de 2000 Euros sur 13 mois')).toEqual({ minAnnual: 26000, maxAnnual: 26000 });
  });

  it('annuel avec fourchette est repris tel quel', () => {
    expect(parseSalaryLabel('Annuel de 45000.00 Euros à 55000.00 Euros')).toEqual({
      minAnnual: 45000,
      maxAnnual: 55000,
    });
  });

  it('annuel avec un seul montant est repris tel quel', () => {
    expect(parseSalaryLabel('Annuel de 45000 Euros')).toEqual({ minAnnual: 45000, maxAnnual: 45000 });
  });

  it('horaire se convertit en annuel via 151,67 heures et douze mois', () => {
    const result = parseSalaryLabel('Horaire de 12.50 Euros');
    expect(result.minAnnual).toBe(Math.round(12.5 * 151.67 * 12));
    expect(result.maxAnnual).toBe(result.minAnnual);
  });

  it('horaire avec fourchette ignore la mention « sur N mois » (deja comptee par le facteur fixe)', () => {
    const result = parseSalaryLabel('Horaire de 11.88 Euros à 13.00 Euros sur 12.00 mois');
    expect(result.minAnnual).toBe(Math.round(11.88 * 151.67 * 12));
    expect(result.maxAnnual).toBe(Math.round(13 * 151.67 * 12));
  });

  it('un cachet n_est pas un motif reconnu et renvoie null', () => {
    expect(parseSalaryLabel('Cachet de 200.00 Euros')).toEqual({ minAnnual: null, maxAnnual: null });
  });

  it('selon profil renvoie null sans jamais estimer', () => {
    expect(parseSalaryLabel('Selon profil')).toEqual({ minAnnual: null, maxAnnual: null });
  });

  it('une fourchette sans periode explicite renvoie null (jamais suppose annuel)', () => {
    expect(parseSalaryLabel('De 30000 à 35000 Euros')).toEqual({ minAnnual: null, maxAnnual: null });
  });

  it('accepte les montants avec espace de milliers et virgule decimale', () => {
    expect(parseSalaryLabel('Annuel de 2 500,00 Euros')).toEqual({ minAnnual: 2500, maxAnnual: 2500 });
  });

  it('renvoie null pour un libelle absent', () => {
    expect(parseSalaryLabel(null)).toEqual({ minAnnual: null, maxAnnual: null });
    expect(parseSalaryLabel(undefined)).toEqual({ minAnnual: null, maxAnnual: null });
    expect(parseSalaryLabel('')).toEqual({ minAnnual: null, maxAnnual: null });
  });
});
