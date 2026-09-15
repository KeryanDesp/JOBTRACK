import { describe, expect, it } from 'vitest';
import { NAV_ITEMS } from './navigation';

describe('NAV_ITEMS', () => {
  it('déclare les neuf sections du cahier des charges', () => {
    expect(NAV_ITEMS.map((item) => item.label)).toEqual([
      'Dashboard',
      'Offres',
      'Mes candidatures',
      'Mon CV',
      'Automatisation',
      'Statistiques',
      'Favoris',
      'Alertes',
      'Paramètres',
    ]);
  });

  it('limite la bottom navigation mobile à quatre entrées principales', () => {
    expect(NAV_ITEMS.filter((item) => item.primary)).toHaveLength(4);
  });

  it('n_a pas deux entrées sur le même chemin', () => {
    const paths = NAV_ITEMS.map((item) => item.to);
    expect(new Set(paths).size).toBe(paths.length);
  });
});
