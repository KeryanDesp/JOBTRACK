import type { ResumeContent, ResumeTemplate } from '@jobtrack/shared';
import { useEffect, useRef, useState } from 'react';
import { cn } from '@/lib/utils';
import { RESUME_TEMPLATE_REGISTRY } from '../lib/templates';

export type ResumePreviewFit = 'auto' | 'none';

export interface ResumePreviewProps {
  content: ResumeContent;
  template: ResumeTemplate;
  /**
   * `'auto'` (défaut) réduit la page A4 pour qu'elle tienne dans la largeur du
   * conteneur (`ResizeObserver`) ; `'none'` l'affiche à l'échelle 1 (aperçu
   * plein écran, spec §2 : « Prévisualiser »).
   */
  fit?: ResumePreviewFit;
  className?: string;
}

/**
 * Cadre d'aperçu A4 (spec §7) : affiche le jumeau HTML du modèle choisi à
 * l'échelle réduite pour tenir dans son conteneur, avec défilement horizontal
 * de secours sur mobile si la réduction ne suffit pas (page très étroite).
 * L'aperçu reste **toujours clair** (délégué aux templates, qui n'utilisent
 * jamais les tokens de thème) — un `ResumePreview` affiché en thème sombre ne
 * doit rien changer au document lui-même.
 */
export function ResumePreview({ content, template, fit = 'auto', className }: ResumePreviewProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const pageRef = useRef<HTMLDivElement>(null);
  const [scale, setScale] = useState(1);

  useEffect(() => {
    if (fit === 'none') {
      setScale(1);
      return;
    }

    const container = containerRef.current;
    const page = pageRef.current;
    if (!container || !page) return;

    const updateScale = () => {
      const containerWidth = container.clientWidth;
      const pageWidth = page.scrollWidth;
      if (containerWidth <= 0 || pageWidth <= 0) return;
      setScale(Math.min(1, containerWidth / pageWidth));
    };

    updateScale();
    const observer = new ResizeObserver(updateScale);
    observer.observe(container);
    return () => observer.disconnect();
  }, [fit, template]);

  const { Preview } = RESUME_TEMPLATE_REGISTRY[template];
  const scaledHeight = pageRef.current ? pageRef.current.scrollHeight * scale : undefined;

  return (
    <figure className={cn('flex flex-col gap-2', className)}>
      <div ref={containerRef} role="group" aria-label="Aperçu du CV" className="w-full overflow-x-auto rounded-md border bg-neutral-100 p-4">
        <div style={{ height: scaledHeight, width: '100%' }}>
          <div
            ref={pageRef}
            style={{ transform: `scale(${scale})`, transformOrigin: 'top left' }}
            className="inline-block shadow-md"
          >
            <Preview content={content} />
          </div>
        </div>
      </div>
      <figcaption className="text-muted-foreground text-xs">Aperçu — le PDF fait foi pour la pagination.</figcaption>
    </figure>
  );
}
