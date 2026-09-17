import { describe, expect, it } from 'vitest';
import { baseJob, baseProfile, baseRequirements, NOW } from '../testing/fixtures';
import { scoreSkills } from './skills';

describe('scoreSkills', () => {
  it('est unknown quand ni l_analyse ni les competences France Travail ne portent de technologie', () => {
    const result = scoreSkills(baseProfile(), baseJob(), baseRequirements(), NOW);
    expect(result.status).toBe('unknown');
    expect(result.score).toBeNull();
  });

  it('vaut 100 quand toutes les technologies exigees et souhaitees sont couvertes', () => {
    const profile = baseProfile({ skills: [{ name: 'React', level: 'ADVANCED' }, { name: 'AWS', level: 'INTERMEDIATE' }] });
    const requirements = baseRequirements({
      technologies: [
        { name: 'React', required: true, category: 'framework' },
        { name: 'AWS', required: false, category: 'cloud' },
      ],
    });
    const result = scoreSkills(profile, baseJob(), requirements, NOW);
    expect(result.score).toBe(100);
    expect(result.evidence.some((e) => e.kind === 'ok' && e.text.includes('React'))).toBe(true);
  });

  it('applique la ponderation 70/30 entre technologies exigees et souhaitees', () => {
    const profile = baseProfile({ skills: [{ name: 'React', level: 'ADVANCED' }] });
    const requirements = baseRequirements({
      technologies: [
        { name: 'React', required: true, category: 'framework' },
        { name: 'AWS', required: false, category: 'cloud' },
      ],
    });
    const result = scoreSkills(profile, baseJob(), requirements, NOW);
    // 100% des exigees (70) + 0% des souhaitees (0) = 70.
    expect(result.score).toBe(70);
  });

  it('reconnait une technologie exigee absente avec une evidence missing', () => {
    const requirements = baseRequirements({
      technologies: [{ name: 'Node.js', required: true, category: 'language' }],
    });
    const result = scoreSkills(baseProfile(), baseJob(), requirements, NOW);
    // Aucune technologie « nice to have » listée : les 30 % correspondants sont
    // retirés du calcul (renormalisation) plutôt que crédités par défaut.
    expect(result.score).toBe(0);
    expect(result.evidence).toEqual([{ kind: 'missing', text: 'Node.js exigé, absent de votre profil' }]);
  });

  it('reconnait une technologie souhaitee absente avec une evidence warn', () => {
    const requirements = baseRequirements({
      technologies: [{ name: 'AWS', required: false, category: 'cloud' }],
    });
    const result = scoreSkills(baseProfile(), baseJob(), requirements, NOW);
    expect(result.evidence).toEqual([{ kind: 'warn', text: 'AWS souhaité, absent de votre profil' }]);
  });

  it('se rabat sur les competences France Travail (JobSkill) quand l_analyse n_a extrait aucune technologie', () => {
    const profile = baseProfile({ skills: [{ name: 'Python', level: 'EXPERT' }] });
    const job = baseJob({ skills: [{ name: 'Python', required: true }] });
    const result = scoreSkills(profile, job, baseRequirements(), NOW);
    expect(result.status).toBe('evaluated');
    expect(result.score).toBe(100);
  });

  it('reconnait les synonymes entre la technologie exigee et la competence du profil', () => {
    const profile = baseProfile({ skills: [{ name: 'ReactJS', level: 'ADVANCED' }] });
    const requirements = baseRequirements({
      technologies: [{ name: 'React', required: true, category: 'framework' }],
    });
    const result = scoreSkills(profile, baseJob(), requirements, NOW);
    // Seule technologie exigée, entièrement couverte, aucune souhaitée à côté : 100 % (renormalisé).
    expect(result.score).toBe(100);
  });

  it('tient compte des technologies de projet du profil', () => {
    const profile = baseProfile({ projectTechnologies: ['Docker'] });
    const requirements = baseRequirements({
      technologies: [{ name: 'Docker', required: true, category: 'tool' }],
    });
    const result = scoreSkills(profile, baseJob(), requirements, NOW);
    expect(result.score).toBe(100);
  });
});
