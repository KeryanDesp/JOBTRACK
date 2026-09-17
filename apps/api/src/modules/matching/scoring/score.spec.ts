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

  it('calcule le score par moyenne ponderee renormalisee : skills 35@100 + experience 15@70 -> 91', () => {
    // Seuls Competences (35) et Experience (15) sont evalues : poids evalue
    // exactement 50, la limite du seuil (>= 50 % passe, jamais < 50 %).
    const profile = baseProfile({ skills: [{ name: 'React', level: 'ADVANCED' }], experienceYears: 2 });
    const job = baseJob({ publishedAt: NOW });
    const requirements = baseRequirements({
      technologies: [{ name: 'React', required: true, category: 'framework' }],
      experienceYearsMin: 3,
    });
    const result = scoreJob(profile, job, requirements, NOW);
    // skills : 1 technologie exigee, entierement couverte -> 100.
    // experience : 3 ans demandes, 2 ans au profil -> il manque 1 an -> 70.
    // (35*100 + 15*70) / 50 = (3500 + 1050) / 50 = 91.
    expect(result.insufficientData).toBe(false);
    expect(result.score).toBe(91);
    expect(result.band).toBe('EXCELLENT');
    expect(result.relevance).toBe(91);
    // >= 85, toutes les technologies exigees couvertes, publiee aujourd'hui.
    expect(result.priority).toBe('VERY_HIGH');
  });

  it('classe en bande EXCELLENT quand tous les facteurs evalues valent 100 (score exact 100)', () => {
    const result = scoreJob(fullyEvaluatedProfile(), fullyEvaluatedJob(), fullyEvaluatedRequirements(), NOW);
    // Les 8 facteurs sont evalues et valent chacun 100 (competence exigee couverte,
    // experience suffisante, commune souhaitee, salaire au-dessus de l'attente,
    // contrat et teletravail souhaites, niveau de formation et langue couverts) :
    // moyenne ponderee = 100.
    expect(result.insufficientData).toBe(false);
    expect(result.score).toBe(100);
    expect(result.band).toBe('EXCELLENT');
  });

  it('classe en bande GOOD : skills 35@70 + experience 15@100 + salary 10@75 -> 78', () => {
    // Un profil partiellement aligne : la technologie souhaitee (AWS) manque,
    // les autres facteurs (localisation, contrat, teletravail, formation,
    // langues) restent unknown faute de donnee, mais le poids evalue (60)
    // reste au-dessus du seuil de 50 %.
    const profile = baseProfile({ skills: [{ name: 'React', level: 'ADVANCED' }], experienceYears: 5, salaryMin: 40000 });
    const job = baseJob({ publishedAt: NOW, salaryMinAnnual: 35000, salaryMaxAnnual: 42000 });
    const requirements = baseRequirements({
      technologies: [
        { name: 'React', required: true, category: 'framework' },
        { name: 'AWS', required: false, category: 'cloud' },
      ],
      experienceYearsMin: 3,
    });
    const result = scoreJob(profile, job, requirements, NOW);
    // skills : React exige (couvert) 70 + AWS souhaite (absent) 0 -> 70.
    // experience : 3 ans demandes, 5 ans au profil -> 100.
    // salary : le maximum de l'offre (42000) couvre l'attente (40000) mais pas
    // le minimum (35000) -> 75.
    // (35*70 + 15*100 + 10*75) / 60 = (2450 + 1500 + 750) / 60 = 4700 / 60 = 78,33 -> 78.
    expect(result.insufficientData).toBe(false);
    expect(result.score).toBe(78);
    expect(result.band).toBe('GOOD');
  });

  it('explanation.top et explanation.weak contiennent exactement les lignes attendues (cas GOOD a 78)', () => {
    const profile = baseProfile({ skills: [{ name: 'React', level: 'ADVANCED' }], experienceYears: 5, salaryMin: 40000 });
    const job = baseJob({ publishedAt: NOW, salaryMinAnnual: 35000, salaryMaxAnnual: 42000 });
    const requirements = baseRequirements({
      technologies: [
        { name: 'React', required: true, category: 'framework' },
        { name: 'AWS', required: false, category: 'cloud' },
      ],
      experienceYearsMin: 3,
    });
    const result = scoreJob(profile, job, requirements, NOW);
    // Ordre par score decroissant : experience (100), salary (75), skills (70),
    // puis la ligne de fraicheur (offre publiee a l'instant).
    expect(result.explanation.top).toEqual([
      '3 an(s) demandé(s), vous en avez 5',
      "La fourchette de salaire de l'offre couvre partiellement votre attente.",
      'React correspond',
      "Publiée aujourd'hui",
    ]);
    // Seule ligne warn/missing disponible : AWS souhaite, absent du profil (skills).
    expect(result.explanation.weak).toEqual(['AWS souhaité, absent de votre profil']);
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

  it('calcule une pertinence quand le score est defini', () => {
    const result = scoreJob(fullyEvaluatedProfile(), fullyEvaluatedJob(), fullyEvaluatedRequirements(), NOW);
    expect(result.relevance).not.toBeNull();
    expect(result.relevance).toBe(result.score);
  });
});
