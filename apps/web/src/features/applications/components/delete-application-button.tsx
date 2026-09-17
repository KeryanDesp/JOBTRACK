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
 * Suppression avec confirmation (spec §2, point 5). La confirmation ferme et
 * `onDeleted()` (qui referme `ApplicationSheet`, cf. son appelant) est appelé
 * de façon optimiste, avant même la réponse du serveur, plutôt qu'à la
 * réussite de la mutation : `ApplicationSheet` reste sinon montée pendant
 * l'aller-retour réseau, et `useApplication` y relance une requête sur un
 * identifiant en cours de suppression — un flash « Candidature introuvable »
 * précédait alors la fermeture réelle. Un échec ne rouvre pas la
 * confirmation (le panneau est déjà fermé) ; le toast d'erreur de
 * `useDeleteApplication` suffit à en informer.
 */
export function DeleteApplicationButton({ id, jobId, onDeleted }: DeleteApplicationButtonProps) {
  const [open, setOpen] = useState(false);
  const remove = useDeleteApplication();

  function handleConfirm(): void {
    setOpen(false);
    onDeleted();
    remove.mutate({ id, jobId });
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
