import { useState } from 'react';
import { Trash2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog';
import { useDeleteApplication } from '../hooks/use-applications';

interface DeleteApplicationButtonProps {
  id: string;
  /** Offre d'origine quand elle est connue : invalide sa fiche (« Candidature suivie »). */
  jobId?: string | null;
  onDeleted: () => void;
}

/**
 * Suppression avec confirmation (spec §2, point 5). Le dialogue ne se ferme
 * qu'après la réussite : un échec laisse la confirmation ouverte, le toast
 * d'erreur venant de `useDeleteApplication`.
 */
export function DeleteApplicationButton({ id, jobId, onDeleted }: DeleteApplicationButtonProps) {
  const [open, setOpen] = useState(false);
  const remove = useDeleteApplication();

  function handleConfirm(): void {
    remove.mutate(
      { id, jobId },
      {
        onSuccess: () => {
          setOpen(false);
          onDeleted();
        },
      },
    );
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button variant="ghost" size="sm" className="text-destructive hover:text-destructive">
          <Trash2 className="size-4" aria-hidden="true" />
          Supprimer
        </Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Supprimer cette candidature ?</DialogTitle>
          <DialogDescription>Cette action est définitive.</DialogDescription>
        </DialogHeader>
        <DialogFooter>
          <DialogClose asChild>
            <Button variant="outline">Annuler</Button>
          </DialogClose>
          <Button variant="destructive" onClick={handleConfirm} disabled={remove.isPending}>
            {remove.isPending ? 'Suppression…' : 'Supprimer définitivement'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
