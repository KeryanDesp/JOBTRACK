import { describe, expect, it } from 'vitest';
import { baseJob, baseProfile, baseRequirements, NOW } from '../testing/fixtures';
import { scoreExperience } from './experience';

describe('scoreExperience', () => {
  it('est unknown quand ni le profil ni l_offre ne portent d_information d_experience', () => {
    const result = scoreExperience(baseProfile(), baseJob(), baseRequirements(), NOW);
    expect(result.status).toBe('unknown');
    expect(result.score).toBeNull();
  });

  it('vaut 100 quand experienceRequired est false, quelle que soit l_experience du profil', () => {
    const job = baseJob({ experienceRequired: false });
    const requirements = baseRequirements({ experienceYearsMin: 10 });
    const result = scoreExperience(baseProfile(), job, requirements, NOW);
    expect(result.score).toBe(100);
    expect(result.evidence[0]?.text).toBe('Débutant accepté');
  });

  it('vaut 100 quand le profil a au moins l_experience demandee', () => {
    const profile = baseProfile({ experienceYears: 5 });
    const requirements = baseRequirements({ experienceYearsMin: 3 });
    const result = scoreExperience(profile, baseJob(), requirements, NOW);
    expect(result.score).toBe(100);
  });

  it('vaut 70 quand il manque un an d_experience', () => {
    const profile = baseProfile({ experienceYears: 2 });
    const requirements = baseRequirements({ experienceYearsMin: 3 });
    const result = scoreExperience(profile, baseJob(), requirements, NOW);
    expect(result.score).toBe(70);
  });

  it('vaut 40 quand il manque deux ans d_experience', () => {
    const profile = baseProfile({ experienceYears: 1 });
    const requirements = baseRequirements({ experienceYearsMin: 3 });
    const result = scoreExperience(profile, baseJob(), requirements, NOW);
    expect(result.score).toBe(40);
  });

  it('vaut 15 quand il manque plus de deux ans d_experience', () => {
    const profile = baseProfile({ experienceYears: 0 });
    const requirements = baseRequirements({ experienceYearsMin: 6 });
    const result = scoreExperience(profile, baseJob(), requirements, NOW);
    expect(result.score).toBe(15);
  });

  it('deduit les annees exigees de la seniorite de l_analyse a defaut d_experienceYearsMin', () => {
    const profile = baseProfile({ experienceYears: 3 });
    const requirements = baseRequirements({ seniority: 'senior' });
    const result = scoreExperience(profile, baseJob(), requirements, NOW);
    // senior => 6 ans, profil a 3 ans => manque 3 ans => 15.
    expect(result.score).toBe(15);
  });

  it('deduit les annees exigees du niveau d_experience de l_offre a defaut de seniorite', () => {
    const profile = baseProfile({ experienceYears: 1 });
    const job = baseJob({ experienceLevel: 'JUNIOR' });
    const result = scoreExperience(profile, job, baseRequirements(), NOW);
    expect(result.score).toBe(100);
  });

  it('est unknown quand le profil declare 0 an et que l_offre n_exige rien (profil vide, jamais 100 par defaut)', () => {
    const profile = baseProfile({ experienceYears: 0 });
    const result = scoreExperience(profile, baseJob(), baseRequirements(), NOW);
    expect(result.status).toBe('unknown');
    expect(result.score).toBeNull();
  });

  it('calcule les annees du profil a partir des experiences quand elles sont renseignees', () => {
    const profile = baseProfile({
      experienceYears: 0,
      experiences: [{ startDate: new Date('2020-09-17'), endDate: new Date('2026-09-17'), isCurrent: false }],
    });
    const requirements = baseRequirements({ experienceYearsMin: 5 });
    const result = scoreExperience(profile, baseJob(), requirements, NOW);
    expect(result.score).toBe(100);
  });
});
