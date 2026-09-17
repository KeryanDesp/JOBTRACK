import type { ResumeChanges as ResumeChangesData, ResumeContent } from '@jobtrack/shared';
import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { ResumeChanges } from './resume-changes';

function makeContent(): ResumeContent {
  return {
    schemaVersion: 1,
    identity: { firstName: 'Alice', lastName: 'Martin', title: null },
    summary: '',
    experiences: [],
    educations: [],
    skills: [],
    languages: [],
    certifications: [],
    projects: [],
  };
}

function makeChanges(overrides: Partial<ResumeChangesData> = {}): ResumeChangesData {
  return {
    title: { before: '', after: '' },
    summary: { before: '', after: '' },
    experiences: [],
    skills: { before: [], after: [] },
    educations: { kept: [], removed: [] },
    certifications: { kept: [], removed: [] },
    projects: { kept: [], removed: [] },
    notes: null,
    ...overrides,
  };
}

describe('ResumeChanges — titres des sections ecartees', () => {
  it('accorde « Formations ecartees » au feminin', () => {
    render(<ResumeChanges changes={makeChanges({ educations: { kept: [], removed: ['edu-1'] } })} content={makeContent()} />);

    expect(screen.getByText('Formations écartées')).toBeInTheDocument();
  });

  it('accorde « Certifications ecartees » au feminin', () => {
    render(<ResumeChanges changes={makeChanges({ certifications: { kept: [], removed: ['cert-1'] } })} content={makeContent()} />);

    expect(screen.getByText('Certifications écartées')).toBeInTheDocument();
  });

  it('accorde « Projets ecartes » au masculin (pas « Projets ecartees »)', () => {
    render(<ResumeChanges changes={makeChanges({ projects: { kept: [], removed: ['proj-1'] } })} content={makeContent()} />);

    expect(screen.getByText('Projets écartés')).toBeInTheDocument();
    expect(screen.queryByText('Projets écartées')).not.toBeInTheDocument();
  });

  it("n'affiche aucune carte quand rien n'est ecarte", () => {
    render(<ResumeChanges changes={makeChanges()} content={makeContent()} />);

    expect(screen.queryByText('Formations écartées')).not.toBeInTheDocument();
    expect(screen.queryByText('Certifications écartées')).not.toBeInTheDocument();
    expect(screen.queryByText(/Projets écart/)).not.toBeInTheDocument();
  });
});
