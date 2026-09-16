import { describe, expect, it } from 'vitest';
import { mapExperience } from './experience';

describe('mapExperience', () => {
  it('D signifie debutant accepte, junior et non exige', () => {
    expect(mapExperience('D', null)).toEqual({ level: 'JUNIOR', required: false });
  });

  it('D ignore un libelle presente meme si incoherent', () => {
    expect(mapExperience('D', '5 An(s)')).toEqual({ level: 'JUNIOR', required: false });
  });

  it('E avec moins d_un an donne junior et exige', () => {
    expect(mapExperience('E', '6 Mois')).toEqual({ level: 'JUNIOR', required: true });
  });

  it('E avec dix-huit mois donne mid et exige', () => {
    expect(mapExperience('E', '18 Mois')).toEqual({ level: 'MID', required: true });
  });

  it('E avec un an exactement donne mid (borne basse incluse)', () => {
    expect(mapExperience('E', '1 An(s)')).toEqual({ level: 'MID', required: true });
  });

  it('E avec trois ans exactement donne mid (borne haute incluse)', () => {
    expect(mapExperience('E', '3 An(s)')).toEqual({ level: 'MID', required: true });
  });

  it('E avec plus de trois ans donne senior', () => {
    expect(mapExperience('E', '5 An(s)')).toEqual({ level: 'SENIOR', required: true });
  });

  it('S se comporte comme E pour le niveau mais n_est pas exige', () => {
    expect(mapExperience('S', '2 ans')).toEqual({ level: 'MID', required: false });
  });

  it('un libelle non exploitable renvoie un niveau nul mais conserve l_exigence', () => {
    expect(mapExperience('E', null)).toEqual({ level: null, required: true });
    expect(mapExperience('S', 'indetermine')).toEqual({ level: null, required: false });
  });

  it('un code experienceExige absent renvoie niveau et exigence nuls', () => {
    expect(mapExperience(null, '5 An(s)')).toEqual({ level: null, required: null });
    expect(mapExperience(undefined, undefined)).toEqual({ level: null, required: null });
  });
});
