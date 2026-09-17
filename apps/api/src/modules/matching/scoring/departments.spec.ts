import { describe, expect, it } from 'vitest';
import { areNeighbours, listDepartmentCodes } from './departments';

const OVERSEAS_CODES = ['971', '972', '973', '974', '975', '976', '977', '978', '984', '986', '987', '988'];

describe('areNeighbours', () => {
  it('reconnait la Moselle et la Meurthe-et-Moselle comme limitrophes', () => {
    expect(areNeighbours('57', '54')).toBe(true);
  });

  it('reconnait Paris et les Hauts-de-Seine comme limitrophes', () => {
    expect(areNeighbours('75', '92')).toBe(true);
  });

  it('reconnait la Corse-du-Sud et la Haute-Corse comme limitrophes', () => {
    expect(areNeighbours('2A', '2B')).toBe(true);
  });

  it('reconnait les Bouches-du-Rhone et le Vaucluse comme limitrophes', () => {
    expect(areNeighbours('13', '84')).toBe(true);
  });

  it('reconnait le Val-d_Oise et la Seine-et-Marne comme limitrophes', () => {
    expect(areNeighbours('95', '77')).toBe(true);
    expect(areNeighbours('77', '95')).toBe(true);
  });

  it('reconnait la Meurthe-et-Moselle et le Bas-Rhin comme limitrophes', () => {
    expect(areNeighbours('54', '67')).toBe(true);
    expect(areNeighbours('67', '54')).toBe(true);
  });

  it('est symetrique quel que soit l_ordre des arguments', () => {
    expect(areNeighbours('54', '57')).toBe(true);
    expect(areNeighbours('92', '75')).toBe(true);
    expect(areNeighbours('2B', '2A')).toBe(true);
    expect(areNeighbours('84', '13')).toBe(true);
  });

  it('renvoie faux pour deux departements non limitrophes', () => {
    expect(areNeighbours('75', '13')).toBe(false);
    expect(areNeighbours('59', '06')).toBe(false);
  });

  it('renvoie faux pour un departement compare a lui-meme', () => {
    expect(areNeighbours('75', '75')).toBe(false);
  });

  it('n_est jamais vrai pour un departement compare a lui-meme, pour tous les codes', () => {
    for (const code of listDepartmentCodes()) {
      expect(areNeighbours(code, code)).toBe(false);
    }
  });

  it('est symetrique pour toute paire de codes de la table (couverture complete)', () => {
    const codes = listDepartmentCodes();
    for (const a of codes) {
      for (const b of codes) {
        expect(areNeighbours(a, b)).toBe(areNeighbours(b, a));
      }
    }
  });
});

describe('listDepartmentCodes', () => {
  it('expose exactement 96 codes (departements metropolitains, 2A/2B pour la Corse)', () => {
    expect(listDepartmentCodes()).toHaveLength(96);
  });

  it('ne contient aucun departement ou collectivite d_outre-mer', () => {
    const codes = new Set(listDepartmentCodes());
    for (const overseas of OVERSEAS_CODES) {
      expect(codes.has(overseas)).toBe(false);
    }
  });

  it('contient 2A et 2B mais jamais le code 20', () => {
    const codes = new Set(listDepartmentCodes());
    expect(codes.has('2A')).toBe(true);
    expect(codes.has('2B')).toBe(true);
    expect(codes.has('20')).toBe(false);
  });
});
