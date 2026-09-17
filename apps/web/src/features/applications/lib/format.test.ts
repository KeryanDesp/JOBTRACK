import type { ApplicationDto } from '@jobtrack/shared';
import { describe, expect, it } from 'vitest';
import { EMPTY_VALUE, formatApplicationDate, resumeLabel, sourceLabel } from './format';

type CvFields = Pick<ApplicationDto, 'resume' | 'usedBaseResume'>;

function cv(overrides: Partial<CvFields> = {}): CvFields {
  return { resume: null, usedBaseResume: false, ...overrides };
}

describe('formatApplicationDate', () => {
  it('formate une date calendaire en francais abrege', () => {
    expect(formatApplicationDate('2026-09-15')).toBe('15 sept. 2026');
  });

  it('ne decale jamais le jour quel que soit le fuseau du navigateur', () => {
    expect(formatApplicationDate('2026-01-01')).toBe('1 janv. 2026');
  });

  it('renvoie le tiret pour une date absente', () => {
    expect(formatApplicationDate(null)).toBe(EMPTY_VALUE);
    expect(formatApplicationDate(undefined)).toBe(EMPTY_VALUE);
    expect(formatApplicationDate('')).toBe(EMPTY_VALUE);
  });

  it('renvoie le tiret pour une date inexploitable', () => {
    expect(formatApplicationDate('pas-une-date')).toBe(EMPTY_VALUE);
  });
});

describe('resumeLabel', () => {
  it('affiche le titre du CV adapte quand il existe', () => {
    expect(resumeLabel(cv({ resume: { id: 'r1', title: 'CV Business Analyst', currentVersion: 2 } }))).toBe('CV Business Analyst');
  });

  it('affiche CV principal quand le CV du profil a ete utilise', () => {
    expect(resumeLabel(cv({ usedBaseResume: true }))).toBe('CV principal');
  });

  it('affiche le tiret quand aucun CV n_a ete utilise', () => {
    expect(resumeLabel(cv())).toBe(EMPTY_VALUE);
  });
});

describe('sourceLabel', () => {
  it('traduit chaque source en francais', () => {
    expect(sourceLabel({ source: 'FRANCE_TRAVAIL' })).toBe('France Travail');
    expect(sourceLabel({ source: 'CAREER_SITE' })).toBe('Site carrière');
    expect(sourceLabel({ source: 'OTHER' })).toBe('Autre');
  });
});
