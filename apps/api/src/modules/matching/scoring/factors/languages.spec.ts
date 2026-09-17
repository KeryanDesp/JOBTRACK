import { describe, expect, it } from 'vitest';
import { baseJob, baseProfile, baseRequirements, NOW } from '../testing/fixtures';
import { scoreLanguages } from './languages';

describe('scoreLanguages', () => {
  it('est unknown quand l_offre n_exige aucune langue', () => {
    const result = scoreLanguages(baseProfile(), baseJob(), baseRequirements(), NOW);
    expect(result.status).toBe('unknown');
  });

  it('vaut 100 quand la langue exigee est presente au niveau demande ou au-dessus', () => {
    const profile = baseProfile({ languages: [{ name: 'Anglais', level: 'C1' }] });
    const requirements = baseRequirements({ languages: [{ name: 'Anglais', level: 'B2', required: true }] });
    const result = scoreLanguages(profile, baseJob(), requirements, NOW);
    expect(result.score).toBe(100);
  });

  it('vaut 60 quand la langue exigee est presente sous le niveau demande', () => {
    const profile = baseProfile({ languages: [{ name: 'Anglais', level: 'B1' }] });
    const requirements = baseRequirements({ languages: [{ name: 'Anglais', level: 'B2', required: true }] });
    const result = scoreLanguages(profile, baseJob(), requirements, NOW);
    expect(result.score).toBe(60);
    expect(result.evidence[0]?.text).toBe('Anglais B2 exigé, vous indiquez B1');
  });

  it('vaut 0 quand la langue exigee est absente du profil', () => {
    const requirements = baseRequirements({ languages: [{ name: 'Allemand', level: 'B2', required: true }] });
    const result = scoreLanguages(baseProfile(), baseJob(), requirements, NOW);
    expect(result.score).toBe(0);
  });

  it('ignore les langues non exigees de l_analyse', () => {
    const requirements = baseRequirements({ languages: [{ name: 'Espagnol', level: 'B1', required: false }] });
    const result = scoreLanguages(baseProfile(), baseJob(), requirements, NOW);
    expect(result.status).toBe('unknown');
  });

  it('fait la moyenne quand plusieurs langues sont exigees', () => {
    const profile = baseProfile({ languages: [{ name: 'Anglais', level: 'C1' }] });
    const requirements = baseRequirements({
      languages: [
        { name: 'Anglais', level: 'B2', required: true },
        { name: 'Allemand', level: 'B2', required: true },
      ],
    });
    const result = scoreLanguages(profile, baseJob(), requirements, NOW);
    // Anglais 100 + Allemand 0, moyenne 50.
    expect(result.score).toBe(50);
  });

  it('reconnait un alias anglais/english pour le nom de la langue', () => {
    const profile = baseProfile({ languages: [{ name: 'English', level: 'C2' }] });
    const requirements = baseRequirements({ languages: [{ name: 'Anglais', level: 'B2', required: true }] });
    const result = scoreLanguages(profile, baseJob(), requirements, NOW);
    expect(result.score).toBe(100);
  });

  it('se rabat sur les exigences France Travail (JobRequirement) quand l_analyse n_exige aucune langue', () => {
    const profile = baseProfile({ languages: [{ name: 'Anglais', level: 'A1' }] });
    const job = baseJob({ languages: [{ label: 'Anglais', required: true }] });
    const result = scoreLanguages(profile, job, baseRequirements(), NOW);
    // Pas de niveau CECRL dans le repli France Travail : la simple presence suffit (seuil A1).
    expect(result.status).toBe('evaluated');
    expect(result.score).toBe(100);
  });

  it('le repli France Travail signale une langue exigee absente du profil', () => {
    const job = baseJob({ languages: [{ label: 'Allemand', required: true }] });
    const result = scoreLanguages(baseProfile(), job, baseRequirements(), NOW);
    expect(result.score).toBe(0);
  });

  it('ignore les exigences France Travail non requises et reste unknown', () => {
    const job = baseJob({ languages: [{ label: 'Espagnol', required: false }] });
    const result = scoreLanguages(baseProfile(), job, baseRequirements(), NOW);
    expect(result.status).toBe('unknown');
  });

  it('privilegie les langues de l_analyse sur le repli France Travail quand les deux sont presentes', () => {
    const profile = baseProfile({ languages: [{ name: 'Anglais', level: 'B2' }] });
    const job = baseJob({ languages: [{ label: 'Allemand', required: true }] });
    const requirements = baseRequirements({ languages: [{ name: 'Anglais', level: 'B2', required: true }] });
    const result = scoreLanguages(profile, job, requirements, NOW);
    expect(result.score).toBe(100);
  });
});
