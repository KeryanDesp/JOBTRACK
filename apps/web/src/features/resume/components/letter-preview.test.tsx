import type { CoverLetterContent } from '@jobtrack/shared';
import { render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { LetterPreview } from './letter-preview';
import { A4_HEIGHT_MM, PX_PER_MM } from './resume-preview';

function makeContent(overrides: Partial<CoverLetterContent> = {}): CoverLetterContent {
  return {
    recipient: null,
    subject: 'Candidature — Développeuse React',
    greeting: 'Madame, Monsieur,',
    paragraphs: ['Premier paragraphe de la lettre.'],
    closing: 'Cordialement,',
    signature: 'Alice Martin',
    ...overrides,
  };
}

const ORIGINAL_CLIENT_WIDTH = Object.getOwnPropertyDescriptor(HTMLElement.prototype, 'clientWidth');
const ORIGINAL_SCROLL_WIDTH = Object.getOwnPropertyDescriptor(HTMLElement.prototype, 'scrollWidth');
const ORIGINAL_SCROLL_HEIGHT = Object.getOwnPropertyDescriptor(HTMLElement.prototype, 'scrollHeight');
const ORIGINAL_OFFSET_HEIGHT = Object.getOwnPropertyDescriptor(HTMLElement.prototype, 'offsetHeight');

// Même principe que `resume-preview.test.tsx` : jsdom ne calcule aucune mise en page reelle, ces
// dimensions sont donc simulees sur le prototype puis restaurees apres chaque test.
function stubDimensions({
  clientWidth,
  scrollWidth,
  scrollHeight,
  offsetHeight,
}: {
  clientWidth?: number;
  scrollWidth?: number;
  scrollHeight?: number;
  offsetHeight?: number;
}) {
  if (clientWidth !== undefined) {
    Object.defineProperty(HTMLElement.prototype, 'clientWidth', { configurable: true, get: () => clientWidth });
  }
  if (scrollWidth !== undefined) {
    Object.defineProperty(HTMLElement.prototype, 'scrollWidth', { configurable: true, get: () => scrollWidth });
  }
  if (scrollHeight !== undefined) {
    Object.defineProperty(HTMLElement.prototype, 'scrollHeight', { configurable: true, get: () => scrollHeight });
  }
  if (offsetHeight !== undefined) {
    Object.defineProperty(HTMLElement.prototype, 'offsetHeight', { configurable: true, get: () => offsetHeight });
  }
}

afterEach(() => {
  if (ORIGINAL_CLIENT_WIDTH) Object.defineProperty(HTMLElement.prototype, 'clientWidth', ORIGINAL_CLIENT_WIDTH);
  if (ORIGINAL_SCROLL_WIDTH) Object.defineProperty(HTMLElement.prototype, 'scrollWidth', ORIGINAL_SCROLL_WIDTH);
  if (ORIGINAL_SCROLL_HEIGHT) Object.defineProperty(HTMLElement.prototype, 'scrollHeight', ORIGINAL_SCROLL_HEIGHT);
  if (ORIGINAL_OFFSET_HEIGHT) Object.defineProperty(HTMLElement.prototype, 'offsetHeight', ORIGINAL_OFFSET_HEIGHT);
});

function renderPreview(content: CoverLetterContent, company: string | null = null) {
  render(
    <LetterPreview
      content={content}
      senderName="Alice Martin"
      senderCity="Metz"
      company={company}
      dateLine="Metz, le 17 septembre 2026"
    />,
  );
}

describe('LetterPreview — pagination', () => {
  it("n annonce jamais « page 2 » sur une lettre courte, meme quand le feuillet reste haut d au moins une page (bug initial, revue tache 6)", () => {
    stubDimensions({ clientWidth: 800, scrollWidth: 800, scrollHeight: A4_HEIGHT_MM * PX_PER_MM, offsetHeight: 300 });

    renderPreview(makeContent());

    expect(screen.getByRole('group', { name: 'Aperçu de la lettre, page 1' })).toBeInTheDocument();
  });

  it('annonce « page 2 » quand le contenu depasse clairement une page', () => {
    stubDimensions({ clientWidth: 800, scrollWidth: 800, offsetHeight: A4_HEIGHT_MM * PX_PER_MM * 1.5 });

    renderPreview(makeContent());

    expect(screen.getByRole('group', { name: 'Aperçu de la lettre, page 2' })).toBeInTheDocument();
  });
});

describe('LetterPreview — destinataire et entreprise', () => {
  it("n affiche l entreprise qu une seule fois quand elle est identique au destinataire (casse/accents ignores)", () => {
    renderPreview(makeContent({ recipient: 'Piloto Software' }), 'piloto software');

    expect(screen.getAllByText(/Piloto Software/i)).toHaveLength(1);
  });

  it('affiche destinataire et entreprise quand ils different', () => {
    renderPreview(makeContent({ recipient: 'Service recrutement' }), 'Piloto Software');

    expect(screen.getByText('Service recrutement')).toBeInTheDocument();
    expect(screen.getByText('Piloto Software')).toBeInTheDocument();
  });
});
