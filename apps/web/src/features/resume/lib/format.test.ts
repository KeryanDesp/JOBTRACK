import { describe, expect, it } from 'vitest';
import { formatDateRange, formatLanguageLevel, formatSkillLevel } from './format';

describe('formatDateRange', () => {
  it('affiche « mois annee - aujourd-hui » pour un poste actuel', () => {
    expect(formatDateRange('2022-03-01', null, true)).toBe("mars 2022 – aujourd'hui");
  });

  it('ignore la date de fin fournie quand isCurrent est vrai', () => {
    expect(formatDateRange('2022-03-01', '2023-01-01', true)).toBe("mars 2022 – aujourd'hui");
  });

  it('affiche une plage complete quand une date de fin existe', () => {
    expect(formatDateRange('2020-09-01', '2022-06-01', false)).toBe('sept. 2020 – juin 2022');
  });

  it('complete par « en cours » quand seule la date de debut existe', () => {
    expect(formatDateRange('2021-01-01', null, false)).toBe('janv. 2021 – en cours');
  });

  it('renvoie une chaine vide sans aucune date', () => {
    expect(formatDateRange(null, null, false)).toBe('');
  });

  it('affiche seulement « aujourd-hui » sans date de debut', () => {
    expect(formatDateRange(null, null, true)).toBe("Aujourd'hui");
  });
});

describe('formatSkillLevel', () => {
  it('traduit chaque niveau de competence', () => {
    expect(formatSkillLevel('BEGINNER')).toBe('Débutant');
    expect(formatSkillLevel('INTERMEDIATE')).toBe('Intermédiaire');
    expect(formatSkillLevel('ADVANCED')).toBe('Avancé');
    expect(formatSkillLevel('EXPERT')).toBe('Expert');
  });
});

describe('formatLanguageLevel', () => {
  it('conserve les niveaux du cadre europeen tels quels', () => {
    expect(formatLanguageLevel('B2')).toBe('B2');
  });

  it('traduit le niveau natif', () => {
    expect(formatLanguageLevel('NATIVE')).toBe('Langue maternelle');
  });
});
