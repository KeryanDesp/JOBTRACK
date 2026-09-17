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

// 1mm = 96/25.4 px à la résolution CSS de référence (96dpi) : conversion
// nécessaire puisque `pageHeightPx` (mesurée en pixels CSS réels par
// `ResizeObserver`) doit être comparée à la hauteur A4 en millimètres pour en
// déduire un nombre de pages approximatif (spec, revue tâche 6).
export const PX_PER_MM = 96 / 25.4;
export const A4_HEIGHT_MM = 297;

/**
 * Nombre de pages approximatif d'après la hauteur naturelle (non réduite) du
 * jumeau HTML : seul le rendu réel du PDF (pagination `@react-pdf/renderer`)
 * fait foi (légende affichée sous l'aperçu) — cette valeur ne sert qu'à
 * l'indication visuelle (nom accessible, séparateurs de page) et peut différer
 * de la pagination PDF exacte (marges, sauts de page réels différents).
 */
function computePageCount(pageHeightPx: number): number {
  if (pageHeightPx <= 0) return 1;
  return Math.max(1, Math.ceil(pageHeightPx / PX_PER_MM / A4_HEIGHT_MM));
}

/**
 * Cadre d'aperçu A4 (spec §7, revue tâche 6) : affiche le jumeau HTML du
 * modèle choisi à l'échelle réduite pour tenir dans son conteneur, avec
 * défilement horizontal de secours sur mobile si la réduction ne suffit pas
 * (page très étroite), et des séparateurs approximatifs à chaque tranche de
 * 297mm pour donner une idée du découpage en pages avant le PDF réel.
 * L'aperçu reste **toujours clair** (délégué aux templates, qui n'utilisent
 * jamais les tokens de thème) — un `ResumePreview` affiché en thème sombre ne
 * doit rien changer au document lui-même.
 */
export function ResumePreview({ content, template, fit = 'auto', className }: ResumePreviewProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const pageRef = useRef<HTMLDivElement>(null);
  const [scale, setScale] = useState(1);
  const [pageHeightPx, setPageHeightPx] = useState(0);

  // Observe le conteneur (largeur disponible) **et** la page (hauteur/largeur
  // naturelles) : un changement de contenu peut faire grandir/rétrécir la page
  // sans que le conteneur change, et c'est justement ce que doit détecter la
  // mesure de hauteur (nombre de pages, séparateurs). `content` est aussi une
  // dépendance de l'effet, pas seulement observée : la mesure doit être
  // recalculée dès que la page a fini de se re-rendre avec le nouveau contenu,
  // sans attendre que `ResizeObserver` le constate lui-même (en test, ce
  // dernier est un stub sans effet — voir `src/test/setup.ts`).
  useEffect(() => {
    const container = containerRef.current;
    const page = pageRef.current;
    if (!container || !page) return;

    function update() {
      if (!container || !page) return;
      setPageHeightPx(page.scrollHeight);

      if (fit === 'none') {
        setScale(1);
        return;
      }

      const containerWidth = container.clientWidth;
      const pageWidth = page.scrollWidth;
      if (containerWidth <= 0 || pageWidth <= 0) return;
      setScale(Math.min(1, containerWidth / pageWidth));
    }

    update();
    const observer = new ResizeObserver(update);
    observer.observe(container);
    observer.observe(page);
    return () => observer.disconnect();
  }, [fit, template, content]);

  const { Preview } = RESUME_TEMPLATE_REGISTRY[template];
  const pageCount = computePageCount(pageHeightPx);
  const pageBreaks = Array.from({ length: Math.max(0, pageCount - 1) }, (_, index) => index + 2);
  const scaledHeight = pageHeightPx > 0 ? pageHeightPx * scale : undefined;

  return (
    <figure className={cn('flex flex-col gap-2', className)}>
      <div
        ref={containerRef}
        role="group"
        aria-label={`Aperçu du CV, page ${pageCount}`}
        tabIndex={0}
        className="w-full overflow-x-auto rounded-md border bg-neutral-100 p-4 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
      >
        <div style={{ height: scaledHeight, width: '100%' }}>
          <div
            ref={pageRef}
            data-slot="resume-preview-page"
            className="relative inline-block shadow-md"
            style={{ transform: `scale(${scale})`, transformOrigin: 'top left' }}
          >
            <Preview content={content} />
            {pageBreaks.map((breakNumber) => (
              <div
                key={breakNumber}
                aria-hidden="true"
                className="pointer-events-none absolute inset-x-0 border-t border-dashed border-red-400"
                style={{ top: `${A4_HEIGHT_MM * (breakNumber - 1)}mm` }}
              >
                <span className="absolute right-0 -translate-y-full rounded-sm bg-red-500 px-1 py-0.5 text-[10px] font-medium text-white">
                  {`Page ${breakNumber}`}
                </span>
              </div>
            ))}
          </div>
        </div>
      </div>
      <figcaption className="text-muted-foreground text-xs">Aperçu — le PDF fait foi pour la pagination.</figcaption>
    </figure>
  );
}
