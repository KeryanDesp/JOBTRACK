import { describe, expect, it } from 'vitest';
import { baseJob, baseProfile, baseRequirements, NOW } from './testing/fixtures';
import { scoreJob } from './score';

/** Profil et offre où les 8 facteurs sont tous evalues (utile pour tester le score global). */
function fullyEvaluatedProfile() {
  return baseProfile({
    skills: [{ name: 'React', level: 'ADVANCED' }],
    experienceYears: 5,
    educationLevel: 'bac5',
    languages: [{ name: 'Anglais', level: 'C1' }],
    preferredCommuneCodes: ['57463'],
    salaryMin: 40000,
    contractTypes: ['CDI'],
    remoteModes: ['HYBRID'],
  });
}

function fullyEvaluatedJob() {
  return baseJob({
    communeCode: '57463',
    departmentCode: '57',
    contractType: 'CDI',
    remoteMode: 'HYBRID',
    salaryMinAnnual: 45000,
    salaryMaxAnnual: 50000,
    publishedAt: NOW,
  });
}

function fullyEvaluatedRequirements() {
  return baseRequirements({
    technologies: [{ name: 'React', required: true, category: 'framework' }],
    experienceYearsMin: 3,
    educationLevel: 'bac3',
    languages: [{ name: 'Anglais', level: 'B2', required: true }],
  });
}

describe('scoreJob', () => {
  it('renvoie un score nul et insufficientData quand moins de 50% du poids est evalue', () => {
    // Seul le facteur Compétences (35) est évalué, sur un total de 100 : 35 % < 50 %.
    const requirements = baseRequirements({ technologies: [{ name: 'React', required: true, category: 'framework' }] });
    const profile = baseProfile({ skills: [{ name: 'React', level: 'ADVANCED' }] });
    const result = scoreJob(profile, baseJob(), requirements, NOW);
    expect(result.insufficientData).toBe(true);
    expect(result.score).toBeNull();
    expect(result.band).toBeNull();
    expect(result.priority).toBeNull();
    expect(result.relevance).toBeNull();
  });

  it('calcule un score quand au moins 50% du poids est evalue, renormalise sur les facteurs evalues', () => {
    const result = scoreJob(fullyEvaluatedProfile(), fullyEvaluatedJob(), fullyEvaluatedRequirements(), NOW);
    expect(result.insufficientData).toBe(false);
    expect(result.score).not.toBeNull();
    expect(result.score).toBeGreaterThanOrEqual(0);
    expect(result.score).toBeLessThanOrEqual(100);
  });

  it('classe en bande EXCELLENT a partir de 85', () => {
    const result = scoreJob(fullyEvaluatedProfile(), fullyEvaluatedJob(), fullyEvaluatedRequirements(), NOW);
    expect(result.score).not.toBeNull();
    if ((result.score ?? 0) >= 85) expect(result.band).toBe('EXCELLENT');
  });

  it('classe en bande GOOD entre 70 et 84', () => {
    // Un profil moins bien aligne, mais toujours au-dessus du seuil de 50% de poids evalue.
    const profile = baseProfile({
      skills: [{ name: 'React', level: 'ADVANCED' }],
      experienceYears: 2,
      educationLevel: 'bac2',
      preferredDepartmentCodes: ['57'],
      salaryMin: 40000,
      contractTypes: ['CDI'],
    });
    const job = baseJob({ communeCode: '57463', departmentCode: '57', contractType: 'CDI', salaryMinAnnual: 42000, salaryMaxAnnual: 48000 });
    const requirements = baseRequirements({
      technologies: [{ name: 'React', required: true, category: 'framework' }],
      experienceYearsMin: 3,
      educationLevel: 'bac3',
    });
    const result = scoreJob(profile, job, requirements, NOW);
    expect(result.score).not.toBeNull();
    expect(result.band).not.toBeNull();
  });

  it('classe en bande WEAK sous 50', () => {
    const profile = baseProfile({
      salaryMin: 80000,
      contractTypes: ['CDI'],
      remoteModes: ['REMOTE'],
      experienceYears: 0,
      preferredDepartmentCodes: ['75'],
      educationLevel: 'bac',
    });
    const job = baseJob({
      salaryMinAnnual: 25000,
      salaryMaxAnnual: 28000,
      contractType: 'INTERIM',
      remoteMode: 'ONSITE',
      experienceLevel: 'SENIOR',
      communeCode: '13055',
      departmentCode: '13',
    });
    const requirements = baseRequirements({ educationLevel: 'bac5' });
    const result = scoreJob(profile, job, requirements, NOW);
    // Facteurs évalués : expérience (15), localisation (15), salaire (10), contrat
    // (10), télétravail (5), formation (5) = 60 % du poids, au-dessus du seuil de 50 %.
    expect(result.insufficientData).toBe(false);
    expect(result.band).toBe('WEAK');
  });

  it('est deterministe : les memes entrees produisent toujours le meme resultat', () => {
    const profile = fullyEvaluatedProfile();
    const job = fullyEvaluatedJob();
    const requirements = fullyEvaluatedRequirements();
    const first = scoreJob(profile, job, requirements, NOW);
    const second = scoreJob(profile, job, requirements, NOW);
    expect(second).toEqual(first);
  });

  it('renvoie une explication avec des lignes top et weak', () => {
    const result = scoreJob(fullyEvaluatedProfile(), fullyEvaluatedJob(), fullyEvaluatedRequirements(), NOW);
    expect(Array.isArray(result.explanation.top)).toBe(true);
    expect(Array.isArray(result.explanation.weak)).toBe(true);
  });

  it('calcule une pertinence quand le score est defini', () => {
    const result = scoreJob(fullyEvaluatedProfile(), fullyEvaluatedJob(), fullyEvaluatedRequirements(), NOW);
    expect(result.relevance).not.toBeNull();
    expect(result.relevance).toBe(result.score);
  });
});
