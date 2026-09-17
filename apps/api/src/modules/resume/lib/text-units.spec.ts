import { describe, expect, it } from 'vitest';
import { extractNumbers, extractProperNouns, sentences } from './text-units';

describe('extractNumbers', () => {
  it('extrait un entier isole', () => {
    expect(extractNumbers('12 personnes dans l_equipe')).toEqual(['12']);
  });

  it('extrait une annee', () => {
    expect(extractNumbers('poste occupe depuis 2020')).toEqual(['2020']);
  });

  it('traite virgule et point decimaux comme equivalents', () => {
    expect(extractNumbers('budget de 2,5 M€')).toEqual(extractNumbers('budget de 2.5 M€'));
  });

  it('traite un pourcentage avec ou sans espace comme equivalent', () => {
    expect(extractNumbers('hausse de 30 %')).toEqual(extractNumbers('hausse de 30%'));
  });

  it('normalise un montant abrege avec espace ou non', () => {
    expect(extractNumbers('leve 2 M€')).toEqual(extractNumbers('leve 2M€'));
  });

  it('reconnait un montant en k', () => {
    expect(extractNumbers('budget de 12k')).toEqual(['12k']);
  });

  it('ignore un chiffre colle a une lettre (sigle technique)', () => {
    expect(extractNumbers('maitrise ES6 et Node.js')).toEqual([]);
  });

  it('ignore les chiffres internes a un token technique comme C++ ou 3D', () => {
    expect(extractNumbers('experience en 3D et C++')).toEqual([]);
  });

  it('extrait plusieurs nombres distincts dans le meme texte', () => {
    expect(extractNumbers('equipe de 12 personnes, budget 30k, hausse de 15 %')).toEqual(['12', '30k', '15%']);
  });

  it('renvoie un tableau vide sans nombre dans le texte', () => {
    expect(extractNumbers('aucune mention chiffree ici')).toEqual([]);
  });
});

describe('sentences', () => {
  it('decoupe un texte en plusieurs phrases', () => {
    expect(sentences('Premiere phrase. Deuxieme phrase ! Troisieme phrase ?')).toEqual([
      'Premiere phrase.',
      'Deuxieme phrase !',
      'Troisieme phrase ?',
    ]);
  });

  it('traite un texte sans ponctuation finale comme une seule phrase', () => {
    expect(sentences('Une seule phrase sans point final')).toEqual(['Une seule phrase sans point final']);
  });

  it('ne coupe pas apres l_abreviation M.', () => {
    expect(sentences('Rendez-vous avec M. Dupont demain.')).toEqual(['Rendez-vous avec M. Dupont demain.']);
  });

  it('ne coupe pas apres etc.', () => {
    expect(sentences('Gestion de projets, budgets, etc. au quotidien.')).toEqual([
      'Gestion de projets, budgets, etc. au quotidien.',
    ]);
  });

  it('ne coupe pas apres cf. ou ex.', () => {
    expect(sentences('Voir cf. annexe. Details ex. fournis ici.')).toEqual([
      'Voir cf. annexe.',
      'Details ex. fournis ici.',
    ]);
  });

  it('renvoie un tableau vide pour un texte vide', () => {
    expect(sentences('')).toEqual([]);
    expect(sentences('   ')).toEqual([]);
  });

  it('ignore les espaces superflus entre phrases', () => {
    expect(sentences('Phrase une.   Phrase deux.')).toEqual(['Phrase une.', 'Phrase deux.']);
  });
});

describe('extractProperNouns', () => {
  it('ignore la majuscule de debut de phrase', () => {
    expect(extractProperNouns('Piloté une équipe de développeurs.')).toEqual([]);
  });

  it('retient un nom propre capitalise hors debut de phrase', () => {
    const result = extractProperNouns("Deploiement realise chez Kubernetes en production.");
    expect(result).toContain('kubernetes');
  });

  it('retient un sigle de deux lettres ou plus', () => {
    const result = extractProperNouns('Ecriture de requetes SQL complexes.');
    expect(result).toContain('sql');
  });

  it('retient un token technique contenant un chiffre', () => {
    const result = extractProperNouns('Migration vers ES6 effectuee.');
    expect(result).toContain('es6');
  });

  it('retient C++ et Node.js comme entites techniques', () => {
    const result = extractProperNouns('Developpement en C++ puis en Node.js.');
    expect(result).toContain(extractProperNouns('C++')[0]);
    expect(result).toContain(extractProperNouns('Node.js')[0]);
  });

  it('fusionne une sequence multi-mots capitalisee en une seule entite', () => {
    const result = extractProperNouns('Mission realisee pour Societe Generale a Paris.');
    expect(result).toContain('societe generale');
    expect(result).toContain('paris');
  });

  it('unifie une forme normale et sa forme canonique via canonicalSkill', () => {
    const withReact = extractProperNouns('Application construite avec React.');
    const withReactJs = extractProperNouns('Application construite avec ReactJS.');
    expect(withReact).toEqual(withReactJs);
  });

  it('exclut les mots-outils francais meme capitalises en milieu de phrase', () => {
    const result = extractProperNouns('Une mission Pour renforcer une equipe.');
    expect(result).not.toContain('pour');
  });

  it('ne retient pas un nombre pur comme nom propre', () => {
    expect(extractProperNouns('Recrutement effectue en 2020.')).toEqual([]);
  });

  it('renvoie un tableau vide pour un texte sans entite', () => {
    expect(extractProperNouns('gestion quotidienne des priorites.')).toEqual([]);
  });
});
