import { describe, expect, it } from 'vitest';
import { baseJob, baseProfile, baseRequirements, NOW } from '../testing/fixtures';
import { scoreContract } from './contract';

describe('scoreContract', () => {
  it('est unknown quand le profil n_a pas de preference de contrat', () => {
    const job = baseJob({ contractType: 'CDI' });
    const result = scoreContract(baseProfile(), job, baseRequirements(), NOW);
    expect(result.status).toBe('unknown');
  });

  it('est unknown quand l_offre n_indique pas de type de contrat', () => {
    const profile = baseProfile({ contractTypes: ['CDI'] });
    const result = scoreContract(profile, baseJob(), baseRequirements(), NOW);
    expect(result.status).toBe('unknown');
  });

  it('vaut 100 quand le contrat de l_offre fait partie des souhaits du profil', () => {
    const profile = baseProfile({ contractTypes: ['CDI', 'FREELANCE'] });
    const job = baseJob({ contractType: 'CDI' });
    const result = scoreContract(profile, job, baseRequirements(), NOW);
    expect(result.score).toBe(100);
    expect(result.evidence[0]?.text).toBe('CDI fait partie de vos types de contrat souhaités.');
  });

  it('vaut 20 quand le contrat de l_offre n_est pas souhaite', () => {
    const profile = baseProfile({ contractTypes: ['CDI'] });
    const job = baseJob({ contractType: 'INTERIM' });
    const result = scoreContract(profile, job, baseRequirements(), NOW);
    expect(result.score).toBe(20);
  });
});
