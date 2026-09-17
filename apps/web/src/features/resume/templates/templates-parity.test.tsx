import type { ResumeContent, ResumeSection } from '@jobtrack/shared';
import { RESUME_SECTION_LABELS } from '@jobtrack/shared';
import { Link } from '@react-pdf/renderer';
import { render, screen } from '@testing-library/react';
import type { ReactNode } from 'react';
import { describe, expect, it } from 'vitest';
import { resumeSections } from '../lib/sections';
import { Pdf as ClassicPdf } from './classic/template.pdf';
import { Preview as ClassicPreview } from './classic/template.preview';
import { Pdf as ModernPdf } from './modern/template.pdf';
import { Preview as ModernPreview } from './modern/template.preview';

/** Fixture avec **tous** les champs optionnels renseignés (revue tâche 6) : coordonnées, liens d'identité, lieu/description d'expérience, filière de formation, url/technologies de projet. */
function makeFullSampleContent(): ResumeContent {
  return {
    schemaVersion: 1,
    identity: {
      firstName: 'Alice',
      lastName: 'Martin',
      title: 'Développeuse React senior',
      email: 'alice@example.com',
      phone: '06 00 00 00 00',
      city: 'Metz',
      country: 'France',
      links: [{ label: 'Portfolio', url: 'https://alice.dev' }],
    },
    summary: 'Développeuse experimentee, specialisee en interfaces reactives.',
    experiences: [
      {
        id: 'exp-1',
        company: 'Piloto Software',
        role: 'Developpeuse React',
        location: 'Nancy',
        startDate: '2022-03-01',
        endDate: null,
        isCurrent: true,
        highlights: ['A construit une interface de recherche.'],
        sourceDescription: 'Développement front-end React chez Piloto Software.',
      },
    ],
    educations: [
      {
        id: 'edu-1',
        school: 'Universite de Lorraine',
        degree: 'Master informatique',
        field: 'Genie logiciel',
        startDate: '2018-09-01',
        endDate: '2020-06-01',
      },
    ],
    skills: [{ id: 'skill-1', name: 'React', category: 'TECHNICAL', level: 'ADVANCED' }],
    languages: [{ id: 'lang-1', name: 'Anglais', level: 'B2' }],
    certifications: [{ id: 'cert-1', name: 'AWS Certified', issuer: 'Amazon Web Services', issuedAt: '2021-01-01' }],
    projects: [
      {
        id: 'proj-1',
        name: 'Projet personnel',
        description: 'Un tableau de bord personnel.',
        url: 'https://github.com/alice/projet',
        technologies: ['TypeScript', 'React'],
      },
    ],
  };
}

/**
 * Parcourt un arbre d'elements React sans le rendre (aucun moteur, ni DOM ni
 * PDF) : `Pdf({ content })` appelle directement le composant fonction (pas de
 * hooks a l'interieur), ce qui suffit a obtenir l'arbre `Document`/`Page`/
 * `View`/`Text`/`Link` imbrique tel que produit par JSX (de simples objets,
 * jamais invoques) ; cette fonction ne fait ensuite que descendre dans
 * `props.children`.
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

interface PdfElementLike {
  type: unknown;
  props?: { children?: ReactNode; src?: unknown };
}

// Parametre en `unknown`, pas `ReactNode` : un garde de type doit renvoyer un
// type assignable a celui de son parametre, et `PdfElementLike` (une forme
// deliberement plus etroite, sans `key`) n'est pas un sous-type de `ReactNode`.
function isPdfElementLike(node: unknown): node is PdfElementLike {
  return typeof node === 'object' && node !== null && 'type' in node;
}

/**
 * Cherche tous les éléments d'un type React donné dans l'arbre (même
 * technique que `collectText`, sans rendu) — utilisé pour vérifier que les
 * liens du PDF sont bien des composants `Link` de `@react-pdf/renderer`
 * (`src`), pas du texte brut qui contiendrait accidentellement la même URL.
 */
function findNodesByType(node: ReactNode, type: unknown): PdfElementLike[] {
  if (node === null || node === undefined || typeof node === 'boolean' || typeof node === 'string' || typeof node === 'number') {
    return [];
  }
  if (Array.isArray(node)) return (node as ReactNode[]).flatMap((child) => findNodesByType(child, type));
  if (!isPdfElementLike(node)) return [];

  const self = node.type === type ? [node] : [];
  return [...self, ...findNodesByType(node.props?.children ?? null, type)];
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
  it('rend les sections non vides dans le meme ordre impose, sur les deux jumeaux', () => {
    const content = makeFullSampleContent();
    const expectedHeadings = resumeSections(content)
      .filter((key): key is Exclude<ResumeSection, 'identity'> => key !== 'identity')
      .map((key) => RESUME_SECTION_LABELS[key]);

    render(<Preview content={content} />);
    // Ordre reel du document (celui qu'un lecteur d'ecran traverse), pas
    // seulement la presence de chaque intitule : `getAllByRole` restitue les
    // `<h2>` dans l'ordre du DOM.
    const renderedHeadings = screen.getAllByRole('heading', { level: 2 }).map((node) => node.textContent);
    expect(renderedHeadings).toEqual(expectedHeadings);

    const pdfText = collectText(Pdf({ content })).join(' | ');
    let searchFrom = 0;
    for (const heading of expectedHeadings) {
      const index = pdfText.indexOf(heading, searchFrom);
      expect(index).toBeGreaterThanOrEqual(0);
      searchFrom = index + heading.length;
    }
  });

  it('omet une section vide sur les deux rendus', () => {
    const content: ResumeContent = { ...makeFullSampleContent(), projects: [], certifications: [] };

    render(<Preview content={content} />);
    expect(screen.queryByText(RESUME_SECTION_LABELS.projects)).not.toBeInTheDocument();
    expect(screen.queryByText(RESUME_SECTION_LABELS.certifications)).not.toBeInTheDocument();

    const pdfText = collectText(Pdf({ content })).join(' | ');
    expect(pdfText).not.toContain(RESUME_SECTION_LABELS.projects);
    expect(pdfText).not.toContain(RESUME_SECTION_LABELS.certifications);
  });

  it('affiche le nom complet dans l entete', () => {
    render(<Preview content={makeFullSampleContent()} />);
    expect(screen.getByText('Alice Martin')).toBeInTheDocument();
  });

  it('rend chaque champ optionnel (role, entreprise, lieu, filiere, organisme, technologies) sur les deux jumeaux', () => {
    const content = makeFullSampleContent();
    const { container } = render(<Preview content={content} />);
    const htmlText = container.textContent ?? '';
    const pdfText = collectText(Pdf({ content })).join(' | ');

    const expectedFragments = [
      content.experiences[0]?.role,
      content.experiences[0]?.company,
      content.experiences[0]?.location,
      content.educations[0]?.field,
      content.certifications[0]?.issuer,
      content.projects[0]?.technologies.join(' · '),
    ];

    for (const fragment of expectedFragments) {
      expect(fragment).toBeTruthy();
      expect(htmlText).toContain(fragment as string);
      expect(pdfText).toContain(fragment as string);
    }
  });

  it("rend l url du projet comme un lien, sur les deux jumeaux (PDF via `Link src`)", () => {
    const content = makeFullSampleContent();
    const projectUrl = content.projects[0]?.url as string;

    render(<Preview content={content} />);
    expect(screen.getByRole('link', { name: projectUrl })).toHaveAttribute('href', projectUrl);

    const pdfLinks = findNodesByType(Pdf({ content }), Link);
    expect(pdfLinks.some((node) => node.props?.src === projectUrl)).toBe(true);
  });

  it("rend les liens d identite (libelle + url), sur les deux jumeaux (PDF via `Link src`)", () => {
    const content = makeFullSampleContent();
    const link = content.identity.links?.[0];
    if (!link) throw new Error('Fixture invalide : aucun lien d identite.');

    render(<Preview content={content} />);
    expect(screen.getByRole('link', { name: link.label })).toHaveAttribute('href', link.url);

    const pdfLinks = findNodesByType(Pdf({ content }), Link);
    expect(pdfLinks.some((node) => node.props?.src === link.url)).toBe(true);
  });
});
