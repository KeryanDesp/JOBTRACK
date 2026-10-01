import { describe, expect, it } from 'vitest';
import { applySuggestion, JOB_CATEGORIES, MAX_SUGGESTIONS, suggestCategories, suggestRoles } from './job-suggestions';

describe('suggestRoles', () => {
  it('propose les metiers d_une categorie tapee dans le champ des postes', () => {
    const suggestions = suggestRoles('informatique');
    expect(suggestions).toContain('Développeur mobile');
    expect(suggestions).toContain('Développeur web');
    expect(suggestions.length).toBeLessThanOrEqual(MAX_SUGGESTIONS);
  });

  it('ignore la casse et les accents, et reconnait les alias', () => {
    expect(suggestRoles('INFORMATIQUE')).toEqual(suggestRoles('informatique'));
    expect(suggestRoles('tech')).toContain('Développeur mobile');
    expect(suggestRoles('sante')).toContain('Infirmier');
  });

  it('trouve un metier par n_importe quel mot de son libelle', () => {
    expect(suggestRoles('mobile')).toEqual(['Développeur mobile']);
    expect(suggestRoles('data')).toEqual(['Data analyst', 'Data scientist', 'Data engineer']);
    expect(suggestRoles('develop')).toContain('Développeur Android');
  });

  it('ne suggere pour le dernier element que ce qui n_est pas deja choisi', () => {
    const suggestions = suggestRoles('Développeur mobile, data');
    expect(suggestions).toEqual(['Data analyst', 'Data scientist', 'Data engineer']);
  });

  it('ne suggere pas un poste deja tape en entier', () => {
    expect(suggestRoles('Data analyst')).toEqual([]);
  });

  it('enchaine sur la categorie des postes deja choisis quand l_element en cours est vide', () => {
    const suggestions = suggestRoles('Développeur mobile, ');
    expect(suggestions).toContain('Développeur iOS');
    expect(suggestions).not.toContain('Développeur mobile');
  });

  it('s_appuie sur les categories recherchees quand rien n_est tape', () => {
    expect(suggestRoles('', ['Ressources humaines'])).toContain('Chargé de recrutement');
    expect(suggestRoles('', [])).toEqual([]);
  });

  it('ne suggere rien pour une saisie inconnue', () => {
    expect(suggestRoles('zzzz')).toEqual([]);
  });
});

describe('suggestCategories', () => {
  it('propose les categories dont le nom ou un alias commence par la saisie', () => {
    expect(suggestCategories('info')).toEqual(['Informatique']);
    expect(suggestCategories('rh')).toEqual(['Ressources humaines']);
  });

  it('exclut les categories deja choisies et ne propose rien sur un element vide', () => {
    expect(suggestCategories('Informatique, ')).toEqual([]);
    expect(suggestCategories('Informatique, inf')).toEqual([]);
  });
});

describe('applySuggestion', () => {
  it('remplace l_element en cours et prepare le suivant', () => {
    expect(applySuggestion('informatique', 'Développeur mobile')).toBe('Développeur mobile, ');
    expect(applySuggestion('Data analyst, dev', 'Développeur web')).toBe('Data analyst, Développeur web, ');
    expect(applySuggestion('Data analyst, ', 'Data engineer')).toBe('Data analyst, Data engineer, ');
  });
});

describe('JOB_CATEGORIES', () => {
  it('reste dans les limites du schema des preferences (80 caracteres par element)', () => {
    for (const category of JOB_CATEGORIES) {
      expect(category.name.length).toBeLessThanOrEqual(80);
      for (const title of category.titles) expect(title.length).toBeLessThanOrEqual(80);
    }
  });
});
