import type { ResumeContent } from '@jobtrack/shared';
import { render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { A4_HEIGHT_MM, PX_PER_MM, ResumePreview } from './resume-preview';

function makeContent(overrides: Partial<ResumeContent> = {}): ResumeContent {
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
    ...overrides,
  };
}

const ORIGINAL_CLIENT_WIDTH = Object.getOwnPropertyDescriptor(HTMLElement.prototype, 'clientWidth');
const ORIGINAL_SCROLL_WIDTH = Object.getOwnPropertyDescriptor(HTMLElement.prototype, 'scrollWidth');
const ORIGINAL_SCROLL_HEIGHT = Object.getOwnPropertyDescriptor(HTMLElement.prototype, 'scrollHeight');

// jsdom ne calcule aucune mise en page reelle (`clientWidth`/`scrollWidth`/
// `scrollHeight` valent toujours 0) : ces trois dimensions sont donc simulees
// par des accesseurs sur le prototype, restaures apres chaque test pour ne
// pas polluer les autres suites du fichier.
function stubDimensions({ clientWidth, scrollWidth, scrollHeight }: { clientWidth?: number; scrollWidth?: number; scrollHeight?: number }) {
  if (clientWidth !== undefined) {
    Object.defineProperty(HTMLElement.prototype, 'clientWidth', { configurable: true, get: () => clientWidth });
  }
  if (scrollWidth !== undefined) {
    Object.defineProperty(HTMLElement.prototype, 'scrollWidth', { configurable: true, get: () => scrollWidth });
  }
  if (scrollHeight !== undefined) {
    Object.defineProperty(HTMLElement.prototype, 'scrollHeight', { configurable: true, get: () => scrollHeight });
  }
}

afterEach(() => {
  if (ORIGINAL_CLIENT_WIDTH) Object.defineProperty(HTMLElement.prototype, 'clientWidth', ORIGINAL_CLIENT_WIDTH);
  if (ORIGINAL_SCROLL_WIDTH) Object.defineProperty(HTMLElement.prototype, 'scrollWidth', ORIGINAL_SCROLL_WIDTH);
  if (ORIGINAL_SCROLL_HEIGHT) Object.defineProperty(HTMLElement.prototype, 'scrollHeight', ORIGINAL_SCROLL_HEIGHT);
});

function getPageElement(): HTMLElement {
  const page = document.querySelector('[data-slot="resume-preview-page"]');
  if (!page) throw new Error('Page introuvable.');
  return page as HTMLElement;
}

describe('ResumePreview', () => {
  it('calcule une echelle reduite quand le conteneur est plus etroit que la page (fit auto)', () => {
    stubDimensions({ clientWidth: 400, scrollWidth: 800, scrollHeight: 800 });

    render(<ResumePreview content={makeContent()} template="CLASSIC" fit="auto" />);

    expect(getPageElement().style.transform).toBe('scale(0.5)');
  });

  it('garde l echelle a 1 en mode fit=none quelle que soit la largeur du conteneur', () => {
    stubDimensions({ clientWidth: 400, scrollWidth: 800, scrollHeight: 800 });

    render(<ResumePreview content={makeContent()} template="CLASSIC" fit="none" />);

    expect(getPageElement().style.transform).toBe('scale(1)');
  });

  it('recalcule la hauteur mesuree et le nombre de pages quand le contenu change', () => {
    stubDimensions({ clientWidth: 800, scrollWidth: 800, scrollHeight: A4_HEIGHT_MM * PX_PER_MM });

    const { rerender } = render(<ResumePreview content={makeContent()} template="CLASSIC" />);
    expect(screen.getByRole('group', { name: 'Aperçu du CV, page 1' })).toBeInTheDocument();

    stubDimensions({ scrollHeight: A4_HEIGHT_MM * PX_PER_MM * 2 });
    rerender(<ResumePreview content={makeContent({ summary: 'Nouveau contenu de CV.' })} template="CLASSIC" />);

    expect(screen.getByRole('group', { name: 'Aperçu du CV, page 2' })).toBeInTheDocument();
  });

  it('porte le nom accessible « Apercu du CV, page N » par defaut sur une seule page', () => {
    stubDimensions({ clientWidth: 800, scrollWidth: 800, scrollHeight: 400 });

    render(<ResumePreview content={makeContent()} template="CLASSIC" />);

    expect(screen.getByRole('group', { name: 'Aperçu du CV, page 1' })).toBeInTheDocument();
  });

  it('rend le conteneur de defilement focalisable au clavier', () => {
    render(<ResumePreview content={makeContent()} template="CLASSIC" />);

    expect(screen.getByRole('group', { name: /aperçu du cv/i })).toHaveAttribute('tabIndex', '0');
  });

  it('affiche un separateur « Page 2 » approximatif quand le contenu depasse une page', () => {
    stubDimensions({ clientWidth: 800, scrollWidth: 800, scrollHeight: A4_HEIGHT_MM * PX_PER_MM * 1.5 });

    render(<ResumePreview content={makeContent()} template="CLASSIC" />);

    expect(screen.getByText('Page 2')).toBeInTheDocument();
  });

  it('n affiche aucun separateur quand le contenu tient sur une seule page', () => {
    stubDimensions({ clientWidth: 800, scrollWidth: 800, scrollHeight: 400 });

    render(<ResumePreview content={makeContent()} template="CLASSIC" />);

    expect(screen.queryByText(/^Page \d+$/)).not.toBeInTheDocument();
  });
});
