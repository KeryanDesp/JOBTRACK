import { describe, expect, it } from 'vitest';
import { baseJob, baseProfile, baseRequirements, NOW } from '../testing/fixtures';
import { scoreLocation } from './location';

describe('scoreLocation', () => {
  it('vaut 100 quand l_analyse indique explicitement du teletravail', () => {
    const requirements = baseRequirements({ remoteMode: 'remote' });
    const result = scoreLocation(baseProfile(), baseJob(), requirements, NOW);
    expect(result.score).toBe(100);
  });

  it('est unknown quand l_offre n_indique pas de commune', () => {
    const profile = baseProfile({ preferredCommuneCodes: ['57463'] });
    const result = scoreLocation(profile, baseJob(), baseRequirements(), NOW);
    expect(result.status).toBe('unknown');
  });

  it('est unknown quand le profil n_a indique aucun lieu souhaite', () => {
    const job = baseJob({ communeCode: '57463', departmentCode: '57' });
    const result = scoreLocation(baseProfile(), job, baseRequirements(), NOW);
    expect(result.status).toBe('unknown');
    expect(result.evidence[0]?.text).toBe("Vous n'avez pas indiqué de lieu souhaité.");
  });

  it('est unknown avec un message dedie quand un lieu souhaite a ete saisi mais n_est pas reconnu', () => {
    const profile = baseProfile({ preferredLocationLabels: ['Metz', 'Nancy'] });
    const job = baseJob({ communeCode: '57463', departmentCode: '57' });
    const result = scoreLocation(profile, job, baseRequirements(), NOW);
    expect(result.status).toBe('unknown');
    expect(result.evidence[0]?.text).toBe(
      'Vos lieux souhaités (Metz, Nancy) ne sont pas reconnus dans le référentiel des communes.',
    );
  });

  it('vaut 100 quand la commune de l_offre fait partie des lieux souhaites', () => {
    const profile = baseProfile({ preferredCommuneCodes: ['57463'] });
    const job = baseJob({ communeCode: '57463', departmentCode: '57' });
    const result = scoreLocation(profile, job, baseRequirements(), NOW);
    expect(result.score).toBe(100);
  });

  it('vaut 80 pour le meme departement qu_un lieu souhaite', () => {
    const profile = baseProfile({ preferredDepartmentCodes: ['57'] });
    const job = baseJob({ communeCode: '54395', departmentCode: '54' });
    const result = scoreLocation(profile, job, baseRequirements(), NOW);
    // 57 (Moselle) et 54 (Meurthe-et-Moselle) sont limitrophes, pas le meme departement.
    expect(result.score).toBe(60);
  });

  it('vaut 80 pour une commune du meme departement qu_un lieu souhaite (code departement identique)', () => {
    const profile = baseProfile({ preferredDepartmentCodes: ['75'] });
    const job = baseJob({ communeCode: '75015', departmentCode: '75' });
    const result = scoreLocation(profile, job, baseRequirements(), NOW);
    expect(result.score).toBe(80);
  });

  it('vaut 20 quand le departement n_est ni identique ni limitrophe', () => {
    const profile = baseProfile({ preferredDepartmentCodes: ['75'] });
    const job = baseJob({ communeCode: '13055', departmentCode: '13' });
    const result = scoreLocation(profile, job, baseRequirements(), NOW);
    expect(result.score).toBe(20);
  });
});
