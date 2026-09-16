import { Bookmark, BookmarkCheck } from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { useSaveJob } from '../hooks/use-jobs';

interface SaveJobButtonProps {
  jobId: string;
  saved: boolean;
  className?: string;
}

/**
 * Bascule optimiste sauvegarde/retrait (spec §7) : `useSaveJob` met déjà à
 * jour tous les caches concernés et fait le rollback en cas d'échec ; ce
 * composant se contente d'afficher un toast d'erreur dans ce seul cas (jamais
 * de confirmation de succès, l'état optimiste étant déjà la confirmation
 * visuelle).
 */
export function SaveJobButton({ jobId, saved, className }: SaveJobButtonProps) {
  const saveJob = useSaveJob();

  function handleClick() {
    const nextSaved = !saved;
    saveJob.mutate(
      { id: jobId, saved: nextSaved },
      {
        onError: () => {
          toast.error(
            nextSaved ? "Impossible de sauvegarder l'offre. Réessayez." : "Impossible de retirer l'offre des favoris. Réessayez.",
          );
        },
      },
    );
  }

  return (
    <Button
      type="button"
      variant={saved ? 'secondary' : 'outline'}
      size="icon"
      aria-pressed={saved}
      aria-label={saved ? 'Retirer des favoris' : "Sauvegarder l'offre"}
      onClick={handleClick}
      disabled={saveJob.isPending}
      className={className}
    >
      {saved ? <BookmarkCheck /> : <Bookmark />}
    </Button>
  );
}
