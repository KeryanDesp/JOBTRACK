import { describe, expect, it } from 'vitest';
import { baseJob, baseProfile, baseRequirements, NOW } from '../testing/fixtures';
import { scoreEducation } from './education';

describe('scoreEducation', () => {
  it('est unknown quand l_offre n_exige aucun niveau de formation', () => {
    const result = scoreEducation(baseProfile(), baseJob(), baseRequirements(), NOW);
    expect(result.status).toBe('unknown');
  });

  it('est unknown quand le niveau exige vaut none', () => {
    const requirements = baseRequirements({ educationLevel: 'none' });
    const result = scoreEducation(baseProfile(), baseJob(), requirements, NOW);
    expect(result.status).toBe('unknown');
  });

  it('vaut 100 quand le niveau du profil atteint ou depasse le niveau demande', () => {
    const profile = baseProfile({ educationLevel: 'bac5' });
    const requirements = baseRequirements({ educationLevel: 'bac3' });
    const result = scoreEducation(profile, baseJob(), requirements, NOW);
    expect(result.score).toBe(100);
  });

  it('vaut 60 quand le profil est un cran en dessous du niveau demande', () => {
    const profile = baseProfile({ educationLevel: 'bac3' });
    const requirements = baseRequirements({ educationLevel: 'bac5' });
    const result = scoreEducation(profile, baseJob(), requirements, NOW);
    expect(result.score).toBe(60);
    expect(result.evidence[0]?.text).toBe('Niveau demandé : Bac+5, votre niveau : Bac+3');
  });

  it('vaut 20 quand le profil est plus de deux crans en dessous du niveau demande', () => {
    const profile = baseProfile({ educationLevel: 'bac' });
    const requirements = baseRequirements({ educationLevel: 'bac5' });
    const result = scoreEducation(profile, baseJob(), requirements, NOW);
    expect(result.score).toBe(20);
  });

  it('traite un profil sans niveau de formation comme le niveau none', () => {
    const requirements = baseRequirements({ educationLevel: 'bac' });
    const result = scoreEducation(baseProfile(), baseJob(), requirements, NOW);
    expect(result.score).toBe(60);
  });
});
