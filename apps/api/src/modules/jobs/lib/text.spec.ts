import { describe, expect, it } from 'vitest';
import { cleanLocationLabel, cleanText, normalizeForKey } from './text';

describe('cleanText', () => {
  it('retire les caracteres de controle ascii sans toucher au texte', () => {
    expect(cleanText('Bonjour\u0000\u0007 monde', 1000)).toBe('Bonjour monde');
  });

  it('retire les sequences bidi utilisees pour deguiser un texte', () => {
    expect(cleanText('Texte\u202e renverse\u2066', 1000)).toBe('Texte renverse');
  });

  it('normalise les fins de ligne windows en fin de ligne unix', () => {
    expect(cleanText('ligne 1\r\nligne 2\r\nligne 3', 1000)).toBe('ligne 1\nligne 2\nligne 3');
  });

  it('coupe les espaces de fin de ligne', () => {
    expect(cleanText('ligne 1   \nligne 2\t\t\nligne 3', 1000)).toBe('ligne 1\nligne 2\nligne 3');
  });

  it('reduit les suites de trois sauts de ligne ou plus a une seule ligne vide', () => {
    expect(cleanText('paragraphe 1\n\n\n\nparagraphe 2', 1000)).toBe('paragraphe 1\n\nparagraphe 2');
  });

  it('laisse un texte plus court que la limite intact', () => {
    expect(cleanText('un texte court', 1000)).toBe('un texte court');
  });

  it('tronque sur une frontiere de mot avec une ellipse quand le texte depasse la limite', () => {
    const result = cleanText('les mots un deux trois quatre cinq six sept', 20);
    expect(result.length).toBeLessThanOrEqual(20);
    expect(result.endsWith('…')).toBe(true);
    expect(result).not.toMatch(/\s…$/);
  });

  it('coupe brutalement un mot unique trop long faute de frontiere disponible', () => {
    const result = cleanText('a'.repeat(50), 10);
    expect(result).toBe(`${'a'.repeat(9)}…`);
  });

  it('remplace une tabulation par un espace plutot que de la supprimer', () => {
    expect(cleanText('mot1\tmot2', 1000)).toBe('mot1 mot2');
  });

  it('ne part pas en retour arriere catastrophique sur une ligne a tres nombreux espaces', () => {
    const input = `a${' '.repeat(20000)}b`;
    const start = performance.now();
    const result = cleanText(input, 100_000);
    const duration = performance.now() - start;

    expect(result).toBe(input);
    // Une seconde, et non quelques millisecondes : ce test garde contre un retour arriere
    // catastrophique, dont le cout sur 20 000 espaces se compte en minutes — pas contre une
    // lenteur de quelques pour cent. Un budget serre ne rendrait pas la regression plus
    // detectable, il ferait seulement echouer le test sur un executeur charge (mesure a
    // 24,6 ms en CI pour un seuil a 20, sur une implementation pourtant lineaire).
    expect(duration).toBeLessThan(1000);
  });
});

describe('normalizeForKey', () => {
  it('retire les diacritiques et met en minuscules', () => {
    expect(normalizeForKey('Ingénieur Étudié')).toBe('ingenieur etudie');
  });

  it('retire la mention h/f entre parentheses', () => {
    expect(normalizeForKey('Développeur (H/F)')).toBe('developpeur');
  });

  it('retire la mention f/h sans parentheses', () => {
    expect(normalizeForKey('Comptable f/h confirme')).toBe('comptable confirme');
  });

  it('retire la mention h/f/x', () => {
    expect(normalizeForKey('Technicien h/f/x')).toBe('technicien');
  });

  it('retire la mention h-f avec un tiret', () => {
    expect(normalizeForKey('Cariste h-f')).toBe('cariste');
  });

  it('reduit la ponctuation et les espaces multiples a un seul espace', () => {
    expect(normalizeForKey("  Solaris   Ingénierie,  S.A.S.  ")).toBe('solaris ingenierie s a s');
  });

  it('ne confond pas un « f/h » a l_interieur d_un mot compose avec la mention de genre', () => {
    const result = normalizeForKey('Chef/Hôtesse de rang');
    expect(result).toBe('chef hotesse de rang');
  });
});

describe('cleanLocationLabel', () => {
  it('nettoie un libelle avec code departement simple', () => {
    expect(cleanLocationLabel('57 - METZ')).toBe('Metz (57)');
  });

  it('conserve un numero d_arrondissement dans le nom', () => {
    expect(cleanLocationLabel('75 - PARIS 01')).toBe('Paris 01 (75)');
  });

  it('met en forme de titre un libelle sans code', () => {
    expect(cleanLocationLabel('METZ')).toBe('Metz');
  });

  it('conserve le tiret d_un nom de commune compose', () => {
    expect(cleanLocationLabel('974 - SAINT-DENIS')).toBe('Saint-Denis (974)');
  });

  it('gere un code departement corse sur deux caracteres', () => {
    expect(cleanLocationLabel('2A - AJACCIO')).toBe('Ajaccio (2A)');
  });

  it('renvoie null quand le libelle est absent', () => {
    expect(cleanLocationLabel(null)).toBeNull();
    expect(cleanLocationLabel(undefined)).toBeNull();
  });

  it('met les particules francaises en minuscules sauf en premier mot', () => {
    expect(cleanLocationLabel('13 - AIX EN PROVENCE')).toBe('Aix en Provence (13)');
  });
});
