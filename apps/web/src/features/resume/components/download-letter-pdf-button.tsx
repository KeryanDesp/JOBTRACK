import { Download, Loader2 } from 'lucide-react';
import { useState } from 'react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { loadLetterPdf, type LetterDocumentProps } from '../lib/letter-templates';

export interface DownloadLetterPdfButtonProps extends LetterDocumentProps {
  fileName: string;
  label?: string;
  disabled?: boolean;
}

/**
 * Génère le PDF de la lettre côté client et déclenche son téléchargement —
 * même principe que `download-pdf-button.tsx` (CV), dupliqué en sibling
 * plutôt que généralisé : celui-ci est spécifique au CV (`content`/`template`
 * liés à `RESUME_TEMPLATE_REGISTRY`) et n'accepte pas un document de lettre
 * (props différentes : identité, entreprise, date). `@react-pdf/renderer` et
 * `letter.pdf.tsx` ne sont importés qu'au clic (`import()`), jamais au
 * chargement de la page (spec §7).
 */
export function DownloadLetterPdfButton({
  content,
  senderName,
  senderCity,
  company,
  dateLine,
  fileName,
  label = 'Télécharger le PDF',
  disabled,
}: DownloadLetterPdfButtonProps) {
  const [isGenerating, setIsGenerating] = useState(false);

  async function handleClick() {
    setIsGenerating(true);
    try {
      const [{ pdf }, { Pdf }] = await Promise.all([import('@react-pdf/renderer'), loadLetterPdf()]);
      const blob = await pdf(<Pdf content={content} senderName={senderName} senderCity={senderCity} company={company} dateLine={dateLine} />).toBlob();

      const url = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      link.download = fileName;
      document.body.appendChild(link);
      link.click();
      link.remove();
      // Différé (macrotâche) : voir `download-pdf-button.tsx`, même raison
      // (certains navigateurs lisent l'URL de façon asynchrone).
      setTimeout(() => URL.revokeObjectURL(url), 0);
    } catch (error) {
      console.error(error);
      toast.error('La génération du PDF a échoué.');
    } finally {
      setIsGenerating(false);
    }
  }

  return (
    <Button type="button" onClick={() => void handleClick()} disabled={disabled || isGenerating}>
      {isGenerating ? <Loader2 className="animate-spin" aria-hidden /> : <Download aria-hidden />}
      {isGenerating ? 'Génération…' : label}
    </Button>
  );
}
