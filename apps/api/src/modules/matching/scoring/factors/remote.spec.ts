import { describe, expect, it } from 'vitest';
import { baseJob, baseProfile, baseRequirements, NOW } from '../testing/fixtures';
import { scoreRemote } from './remote';

describe('scoreRemote', () => {
  it('est unknown quand ni l_analyse ni l_offre n_indiquent de mode de teletravail', () => {
    const result = scoreRemote(baseProfile(), baseJob(), baseRequirements(), NOW);
    expect(result.status).toBe('unknown');
  });

  it('vaut 100 quand le mode explicite de l_analyse correspond aux preferences du profil', () => {
    const profile = baseProfile({ remoteModes: ['HYBRID'] });
    const requirements = baseRequirements({ remoteMode: 'hybrid' });
    const result = scoreRemote(profile, baseJob(), requirements, NOW);
    expect(result.score).toBe(100);
  });

  it('vaut 30 quand le mode est incompatible avec les preferences du profil', () => {
    const profile = baseProfile({ remoteModes: ['ONSITE'] });
    const requirements = baseRequirements({ remoteMode: 'remote' });
    // Le facteur teletravail (pas Localisation) reste evalue meme pour du remote explicite.
    const result = scoreRemote(profile, baseJob(), requirements, NOW);
    expect(result.score).toBe(30);
  });

  it('considere un profil sans preference comme compatible avec tout mode', () => {
    const requirements = baseRequirements({ remoteMode: 'onsite' });
    const result = scoreRemote(baseProfile(), baseJob(), requirements, NOW);
    expect(result.score).toBe(100);
  });

  it('se rabat sur le mode deduit de l_offre (tranche 3) quand l_analyse n_a rien d_explicite', () => {
    const profile = baseProfile({ remoteModes: ['HYBRID'] });
    const job = baseJob({ remoteMode: 'HYBRID', remoteModeInferred: true });
    const result = scoreRemote(profile, job, baseRequirements(), NOW);
    expect(result.score).toBe(100);
    expect(result.evidence[0]?.text).toContain('déduit');
  });
});
