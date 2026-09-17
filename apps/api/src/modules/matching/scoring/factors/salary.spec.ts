import { describe, expect, it } from 'vitest';
import { baseJob, baseProfile, baseRequirements, NOW } from '../testing/fixtures';
import { scoreSalary } from './salary';

describe('scoreSalary', () => {
  it('est unknown quand le profil n_a pas indique de salaire souhaite', () => {
    const job = baseJob({ salaryMinAnnual: 40000, salaryMaxAnnual: 45000 });
    const result = scoreSalary(baseProfile(), job, baseRequirements(), NOW);
    expect(result.status).toBe('unknown');
  });

  it('est unknown quand l_offre n_indique pas de salaire', () => {
    const profile = baseProfile({ salaryMin: 40000 });
    const result = scoreSalary(profile, baseJob(), baseRequirements(), NOW);
    expect(result.status).toBe('unknown');
    expect(result.evidence[0]?.text).toContain("n'indique pas de salaire");
  });

  it('vaut 100 quand le minimum de l_offre depasse l_attente', () => {
    const profile = baseProfile({ salaryMin: 40000 });
    const job = baseJob({ salaryMinAnnual: 42000, salaryMaxAnnual: 48000 });
    const result = scoreSalary(profile, job, baseRequirements(), NOW);
    expect(result.score).toBe(100);
  });

  it('vaut 75 quand seul le maximum atteint l_attente', () => {
    const profile = baseProfile({ salaryMin: 40000 });
    const job = baseJob({ salaryMinAnnual: 35000, salaryMaxAnnual: 42000 });
    const result = scoreSalary(profile, job, baseRequirements(), NOW);
    expect(result.score).toBe(75);
  });

  it('vaut 30 quand le maximum de l_offre reste sous l_attente', () => {
    const profile = baseProfile({ salaryMin: 40000 });
    const job = baseJob({ salaryMinAnnual: 30000, salaryMaxAnnual: 35000 });
    const result = scoreSalary(profile, job, baseRequirements(), NOW);
    expect(result.score).toBe(30);
  });
});
