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

  // Bornes exactes (revue) : troncature (jamais un arrondi qui anticipe une
  // unite pas encore ecoulee) et ecarts futurs ramenes a 0.
  it('reste a l_instant juste sous la borne de 60 secondes (59 s)', () => {
    expect(formatRelativeTime(isoBefore(59_000), NOW)).toBe("à l'instant");
  });

  it('bascule sur les minutes exactement a 60 secondes', () => {
    expect(formatRelativeTime(isoBefore(60_000), NOW)).toBe('il y a 1 minute');
  });

  it('tronque a 23 heures a 23 h 59 (n_arrondit pas a 24 heures)', () => {
    expect(formatRelativeTime(isoBefore(23 * 3_600_000 + 59 * 60_000), NOW)).toBe('il y a 23 heures');
  });

  it('affiche hier a 47 heures (pas encore 2 jours entiers)', () => {
    expect(formatRelativeTime(isoBefore(47 * 3_600_000), NOW)).toBe('hier');
  });

  it('affiche 3 jours a 72 heures', () => {
    expect(formatRelativeTime(isoBefore(72 * 3_600_000), NOW)).toBe('il y a 3 jours');
  });

  it('affiche la semaine derniere a exactement 7 jours', () => {
    expect(formatRelativeTime(isoBefore(7 * 24 * 3_600_000), NOW)).toBe('la semaine dernière');
  });

  it('ramene un ecart futur a a l_instant plutot qu_un « dans X »', () => {
    expect(formatRelativeTime(new Date(NOW.getTime() + 3_600_000).toISOString(), NOW)).toBe("à l'instant");
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

  it('formate une valeur unique sans tiret quand les deux bornes sont egales', () => {
    expect(formatSalaryRange(45_000, 45_000)).toBe('45 k€');
  });

  it('compacte les deux bornes ensemble dès que max atteint 1000, meme si min est plus petit', () => {
    expect(formatSalaryRange(800, 1_500)).toBe('1–2 k€');
  });

  it('n_utilise pas le format compact quand max reste sous 1000', () => {
    expect(formatSalaryRange(200, 800)).toBe('200–800 €');
  });

  it('utilise Intl.NumberFormat en notation compacte pour une devise non EUR', () => {
    // Construit l'attendu avec le meme formateur plutot qu'un litteral : les
    // espaces inserees par `Intl.NumberFormat` (insecables/etroites) ne sont
    // pas des espaces ordinaires et rendraient un litteral copie-colle fragile.
    const usd = new Intl.NumberFormat('fr-FR', {
      style: 'currency',
      currency: 'USD',
      notation: 'compact',
      maximumFractionDigits: 0,
    });
    expect(formatSalaryRange(45_000, 70_000, 'USD')).toBe(`${usd.format(45_000)}–${usd.format(70_000)}`);
  });

  it('applique la meme regle de devise non EUR a une borne unique', () => {
    const usd = new Intl.NumberFormat('fr-FR', {
      style: 'currency',
      currency: 'USD',
      notation: 'compact',
      maximumFractionDigits: 0,
    });
    expect(formatSalaryRange(45_000, null, 'USD')).toBe(`à partir de ${usd.format(45_000)}`);
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
