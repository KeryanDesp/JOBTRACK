import { describe, expect, it } from 'vitest';
import { baseJob, baseProfile, baseRequirements, NOW } from './testing/fixtures';
import { computePriority } from './priority';

describe('computePriority', () => {
  it('vaut LOW sous 45', () => {
    expect(computePriority(30, baseProfile(), baseJob(), baseRequirements(), NOW)).toBe('LOW');
  });

  it('vaut CONSIDER entre 45 et 59', () => {
    expect(computePriority(50, baseProfile(), baseJob(), baseRequirements(), NOW)).toBe('CONSIDER');
  });

  it('vaut GOOD entre 60 et 74', () => {
    expect(computePriority(65, baseProfile(), baseJob(), baseRequirements(), NOW)).toBe('GOOD');
  });

  it('vaut HIGH entre 75 et 84', () => {
    expect(computePriority(80, baseProfile(), baseJob(), baseRequirements(), NOW)).toBe('HIGH');
  });

  it('vaut VERY_HIGH a partir de 85 quand toutes les technologies exigees sont couvertes et l_offre est recente', () => {
    const profile = baseProfile({ skills: [{ name: 'React', level: 'ADVANCED' }] });
    const job = baseJob({ publishedAt: NOW });
    const requirements = baseRequirements({ technologies: [{ name: 'React', required: true, category: 'framework' }] });
    expect(computePriority(90, profile, job, requirements, NOW)).toBe('VERY_HIGH');
  });

  it('retombe a HIGH quand une technologie exigee manque, meme avec un score de 90', () => {
    const job = baseJob({ publishedAt: NOW });
    const requirements = baseRequirements({ technologies: [{ name: 'React', required: true, category: 'framework' }] });
    expect(computePriority(90, baseProfile(), job, requirements, NOW)).toBe('HIGH');
  });

  it('retombe a HIGH quand l_offre a plus de 3 jours, meme avec toutes les technologies couvertes', () => {
    const profile = baseProfile({ skills: [{ name: 'React', level: 'ADVANCED' }] });
    const job = baseJob({ publishedAt: new Date(NOW.getTime() - 10 * 24 * 60 * 60 * 1000) });
    const requirements = baseRequirements({ technologies: [{ name: 'React', required: true, category: 'framework' }] });
    expect(computePriority(90, profile, job, requirements, NOW)).toBe('HIGH');
  });
});
