import { describe, expect, it } from 'vitest';
import { educationLevelFromDegree, maxEducationLevel } from './education-level';

describe('educationLevelFromDegree', () => {
  it('reconnait BTS et DUT comme bac2', () => {
    expect(educationLevelFromDegree('BTS Informatique')).toBe('bac2');
    expect(educationLevelFromDegree('DUT Informatique')).toBe('bac2');
    expect(educationLevelFromDegree('Bac+2')).toBe('bac2');
  });

  it('reconnait Licence et Bachelor comme bac3', () => {
    expect(educationLevelFromDegree('Licence Informatique')).toBe('bac3');
    expect(educationLevelFromDegree('Bachelor Informatique')).toBe('bac3');
    expect(educationLevelFromDegree('Bac+3')).toBe('bac3');
  });

  it('reconnait Master, Ingenieur et MBA comme bac5', () => {
    expect(educationLevelFromDegree('Master Informatique')).toBe('bac5');
    expect(educationLevelFromDegree("Diplôme d'ingénieur")).toBe('bac5');
    expect(educationLevelFromDegree('MBA')).toBe('bac5');
    expect(educationLevelFromDegree('Bac+5')).toBe('bac5');
  });

  it('reconnait Doctorat et PhD comme phd', () => {
    expect(educationLevelFromDegree('Doctorat en physique')).toBe('phd');
    expect(educationLevelFromDegree('PhD in Computer Science')).toBe('phd');
  });

  it('reconnait Bac et Baccalaureat comme bac', () => {
    expect(educationLevelFromDegree('Baccalauréat scientifique')).toBe('bac');
    expect(educationLevelFromDegree('Bac Pro')).toBe('bac');
  });

  it('renvoie null pour un intitule inconnu', () => {
    expect(educationLevelFromDegree('Certificat de plongée')).toBeNull();
  });

  it('est insensible aux accents et a la casse', () => {
    expect(educationLevelFromDegree('MASTER')).toBe('bac5');
    expect(educationLevelFromDegree('ingénieur')).toBe('bac5');
  });
});

describe('maxEducationLevel', () => {
  it('renvoie le niveau le plus eleve parmi une liste', () => {
    expect(maxEducationLevel(['bac', 'bac5', 'bac2'])).toBe('bac5');
  });

  it('ignore les valeurs null', () => {
    expect(maxEducationLevel([null, 'bac3', null])).toBe('bac3');
  });

  it('renvoie null si la liste est vide ou entierement nulle', () => {
    expect(maxEducationLevel([])).toBeNull();
    expect(maxEducationLevel([null, null])).toBeNull();
  });
});
