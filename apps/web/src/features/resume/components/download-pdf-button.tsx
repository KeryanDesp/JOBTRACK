import type { ResumeContent, ResumeTemplate } from '@jobtrack/shared';
import { Download, Loader2 } from 'lucide-react';
import { useState } from 'react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { RESUME_TEMPLATE_REGISTRY } from '../lib/templates';

export interface DownloadPdfButtonProps {
  content: ResumeContent;
  template: ResumeTemplate;
  fileName: string;
  label?: string;
  disabled?: boolean;
}

/**
 * Génère le PDF côté client et déclenche son téléchargement (spec §2/§7).
 * `@react-pdf/renderer` et le composant `Pdf` du modèle choisi ne sont
 * importés qu'au clic (`import()`), jamais au chargement de la page : c'est
 * la seule façon dont la bibliothèque (~500 ko) entre dans un chunk, et elle
 * n'entre dans **aucun** chunk tant que l'utilisateur n'a pas cliqué.
 *
 * `URL.revokeObjectURL` est différé dans une macrotâche (`setTimeout(…, 0)`)
 * plutôt qu'appelé immédiatement après le clic simulé : certains navigateurs
 * démarrent le téléchargement de façon asynchrone (tâche interne), et
 * révoquer l'URL avant qu'ils l'aient réellement lue romprait le
 * téléchargement — reporter au tour de boucle suivant laisse le clic
 * synchrone se traiter en premier.
 */
export function DownloadPdfButton({ content, template, fileName, label = 'Télécharger le PDF', disabled }: DownloadPdfButtonProps) {
  const [isGenerating, setIsGenerating] = useState(false);

  async function handleClick() {
    setIsGenerating(true);
    try {
      const [{ pdf }, { Pdf }] = await Promise.all([import('@react-pdf/renderer'), RESUME_TEMPLATE_REGISTRY[template].loadPdf()]);
      const blob = await pdf(<Pdf content={content} />).toBlob();

      const url = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      link.download = fileName;
      document.body.appendChild(link);
      link.click();
      link.remove();
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
