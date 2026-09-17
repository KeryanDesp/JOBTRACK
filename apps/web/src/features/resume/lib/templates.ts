import type { ResumeContent, ResumeTemplate } from '@jobtrack/shared';
import { RESUME_TEMPLATE_LABELS, RESUME_TEMPLATES } from '@jobtrack/shared';
import type { ComponentType } from 'react';
import { Preview as ClassicPreview } from '../templates/classic/template.preview';
import { Preview as ModernPreview } from '../templates/modern/template.preview';

// `@react-pdf/renderer` est épinglé en version exacte (`4.9.0`, sans `^`) dans
// `apps/web/package.json` : c'est la version demandée par la tâche 6 (spec §1),
// et une bibliothèque de rendu PDF où une montée de version mineure peut
// changer la mise en page produite (métriques de police, pagination) — une
// mise à jour reste possible, mais doit rester un choix explicite plutôt
// qu'une résolution automatique de `^4.x`.

export interface ResumePdfModule {
  Pdf: ComponentType<{ content: ResumeContent }>;
}

export interface ResumeTemplateDefinition {
  label: string;
  Preview: ComponentType<{ content: ResumeContent }>;
  /**
   * Import paresseux du module PDF (`template.pdf.tsx`) : c'est la seule voie
   * d'accès à `@react-pdf/renderer` (spec §7, tâche 6) — ni ce fichier ni
   * `template.preview.tsx` n'importent la bibliothèque au niveau module, pour
   * qu'elle reste hors du bundle initial et n'entre dans un chunk que lorsque
   * `download-pdf-button.tsx` déclenche réellement cet `import()`.
   */
  loadPdf: () => Promise<ResumePdfModule>;
}

export const RESUME_TEMPLATE_REGISTRY: Record<ResumeTemplate, ResumeTemplateDefinition> = {
  CLASSIC: {
    label: RESUME_TEMPLATE_LABELS.CLASSIC,
    Preview: ClassicPreview,
    loadPdf: () => import('../templates/classic/template.pdf'),
  },
  MODERN: {
    label: RESUME_TEMPLATE_LABELS.MODERN,
    Preview: ModernPreview,
    loadPdf: () => import('../templates/modern/template.pdf'),
  },
};

export const RESUME_TEMPLATE_OPTIONS = RESUME_TEMPLATES.map((template) => ({
  value: template,
  label: RESUME_TEMPLATE_REGISTRY[template].label,
}));
