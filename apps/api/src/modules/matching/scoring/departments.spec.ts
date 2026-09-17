import { describe, expect, it } from 'vitest';
import { areNeighbours } from './departments';

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
});
