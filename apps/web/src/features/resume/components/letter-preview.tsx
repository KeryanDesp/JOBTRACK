import type { CoverLetterContent } from '@jobtrack/shared';
import { useEffect, useRef, useState } from 'react';
import { cn } from '@/lib/utils';
import { A4_HEIGHT_MM, computePageCount, measureContentHeight } from './resume-preview';
import { Preview as LetterDocumentPreview } from '../templates/letter/letter.preview';

export interface LetterPreviewProps {
  content: CoverLetterContent;
  senderName: string;
  senderCity: string | null;
  company: string | null;
  dateLine: string;
  className?: string;
}

/**
 * Cadre d'aperçu A4 de la lettre de motivation (spec §2/§7, tâche 8) : même
 * principe que `ResumePreview` (réduction à l'échelle du conteneur, séparateurs
 * de page approximatifs) — non réutilisé directement, `ResumePreview` est lié
 * au registre des modèles de CV (`RESUME_TEMPLATE_REGISTRY`) et ne prend pas
 * de contenu générique. Toujours clair : document papier, jamais le thème
 * sombre de l'application.
 */
export function LetterPreview({ content, senderName, senderCity, company, dateLine, className }: LetterPreviewProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const pageRef = useRef<HTMLDivElement>(null);
  const [scale, setScale] = useState(1);
  // Hauteur visuelle réelle du feuillet et hauteur du contenu — distinctes depuis la revue tâche 6
  // fixup (voir le même commentaire dans `resume-preview.tsx`).
  const [sheetHeightPx, setSheetHeightPx] = useState(0);
  const [contentHeightPx, setContentHeightPx] = useState(0);

  useEffect(() => {
    const container = containerRef.current;
    const page = pageRef.current;
    if (!container || !page) return;

    function update() {
      if (!container || !page) return;
      setSheetHeightPx(page.scrollHeight);
      setContentHeightPx(measureContentHeight(page.firstElementChild as HTMLElement | null));
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
  }, [content, senderName, senderCity, company, dateLine]);

  const pageCount = computePageCount(contentHeightPx);
  const pageBreaks = Array.from({ length: Math.max(0, pageCount - 1) }, (_, index) => index + 2);
  const scaledHeight = sheetHeightPx > 0 ? sheetHeightPx * scale : undefined;

  return (
    <figure className={cn('flex flex-col gap-2', className)}>
      <div
        ref={containerRef}
        role="group"
        aria-label={`Aperçu de la lettre, page ${pageCount}`}
        tabIndex={0}
        className="w-full overflow-x-auto rounded-md border bg-neutral-100 p-4 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
      >
        <div style={{ height: scaledHeight, width: '100%' }}>
          <div
            ref={pageRef}
            data-slot="letter-preview-page"
            className="relative inline-block shadow-md"
            style={{ transform: `scale(${scale})`, transformOrigin: 'top left' }}
          >
            <LetterDocumentPreview content={content} senderName={senderName} senderCity={senderCity} company={company} dateLine={dateLine} />
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
