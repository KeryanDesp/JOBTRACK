import type { ResumeContent, ResumeSection } from '@jobtrack/shared';
import { RESUME_SECTION_LABELS } from '@jobtrack/shared';
import { render, screen } from '@testing-library/react';
import type { ReactNode } from 'react';
import { describe, expect, it } from 'vitest';
import { resumeSections } from '../lib/sections';
import { Pdf as ClassicPdf } from './classic/template.pdf';
import { Preview as ClassicPreview } from './classic/template.preview';
import { Pdf as ModernPdf } from './modern/template.pdf';
import { Preview as ModernPreview } from './modern/template.preview';

function makeSampleContent(): ResumeContent {
  return {
    schemaVersion: 1,
    identity: { firstName: 'Alice', lastName: 'Martin', title: 'Développeuse React', email: 'alice@example.com' },
    summary: 'Développeuse experimentee, specialisee en interfaces reactives.',
    experiences: [
      {
        id: 'exp-1',
        company: 'Piloto Software',
        role: 'Développeuse React',
        location: 'Metz',
        startDate: '2022-03-01',
        endDate: null,
        isCurrent: true,
        highlights: ['A construit une interface de recherche.'],
        sourceDescription: null,
      },
    ],
    educations: [
      { id: 'edu-1', school: 'Universite de Lorraine', degree: 'Master informatique', field: null, startDate: '2018-09-01', endDate: '2020-06-01' },
    ],
    skills: [{ id: 'skill-1', name: 'React', category: 'TECHNICAL', level: 'ADVANCED' }],
    languages: [{ id: 'lang-1', name: 'Anglais', level: 'B2' }],
    certifications: [{ id: 'cert-1', name: 'AWS Certified', issuer: 'Amazon', issuedAt: '2021-01-01' }],
    projects: [{ id: 'proj-1', name: 'Projet personnel', description: null, url: null, technologies: ['TypeScript'] }],
  };
}

/**
 * Parcourt un arbre d'elements React sans le rendre (aucun moteur, ni DOM ni
 * PDF) : `Pdf({ content })` appelle directement le composant fonction (pas de
 * hooks a l'interieur), ce qui suffit a obtenir l'arbre `Document`/`Page`/
 * `View`/`Text` imbrique tel que produit par JSX (de simples objets, jamais
 * invoques) ; cette fonction ne fait ensuite que descendre dans `props.children`.
 */
function collectText(node: ReactNode): string[] {
  if (node === null || node === undefined || typeof node === 'boolean') return [];
  if (typeof node === 'string') return [node];
  if (typeof node === 'number') return [String(node)];
  if (Array.isArray(node)) return (node as ReactNode[]).flatMap((child) => collectText(child));
  if (typeof node === 'object' && 'props' in node) {
    const children = (node as { props?: { children?: ReactNode } }).props?.children;
    return collectText(children ?? null);
  }
  return [];
}

// Signature volontairement plus stricte que `FunctionComponent` (dont le type
// de retour inclut `Promise<ReactNode>`, pour les composants serveur
// asynchrones) : ni `Preview` ni `Pdf` ne le sont, et `collectText` doit
// pouvoir recevoir directement le retour de `Pdf({ content })`.
type TemplateComponent = (props: { content: ResumeContent }) => ReactNode;

interface TemplateUnderTest {
  name: string;
  Preview: TemplateComponent;
  Pdf: TemplateComponent;
}

const TEMPLATES: TemplateUnderTest[] = [
  { name: 'Classique', Preview: ClassicPreview, Pdf: ClassicPdf },
  { name: 'Moderne', Preview: ModernPreview, Pdf: ModernPdf },
];

describe.each(TEMPLATES)('parite HTML/PDF du modele $name', ({ Preview, Pdf }) => {
  it('rend les memes sections, dans le meme ordre, sur les deux jumeaux', () => {
    const content = makeSampleContent();
    const expectedHeadings = resumeSections(content)
      .filter((key): key is Exclude<ResumeSection, 'identity'> => key !== 'identity')
      .map((key) => RESUME_SECTION_LABELS[key]);

    render(<Preview content={content} />);
    for (const heading of expectedHeadings) {
      expect(screen.getByText(heading)).toBeInTheDocument();
    }

    const pdfText = collectText(Pdf({ content })).join(' | ');
    let searchFrom = 0;
    for (const heading of expectedHeadings) {
      const index = pdfText.indexOf(heading, searchFrom);
      expect(index).toBeGreaterThanOrEqual(0);
      searchFrom = index + heading.length;
    }
  });

  it('omet une section vide sur les deux rendus', () => {
    const content: ResumeContent = { ...makeSampleContent(), projects: [], certifications: [] };

    render(<Preview content={content} />);
    expect(screen.queryByText(RESUME_SECTION_LABELS.projects)).not.toBeInTheDocument();
    expect(screen.queryByText(RESUME_SECTION_LABELS.certifications)).not.toBeInTheDocument();

    const pdfText = collectText(Pdf({ content })).join(' | ');
    expect(pdfText).not.toContain(RESUME_SECTION_LABELS.projects);
    expect(pdfText).not.toContain(RESUME_SECTION_LABELS.certifications);
  });

  it('affiche le nom complet dans l entete', () => {
    render(<Preview content={makeSampleContent()} />);
    expect(screen.getByText('Alice Martin')).toBeInTheDocument();
  });
});
