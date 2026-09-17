import { Plus } from 'lucide-react';
import { Button } from '@/components/ui/button';

interface AddApplicationButtonProps {
  onClick: () => void;
  /** `outline` pour l'état vide, où le bouton voisine « Voir les offres ». */
  variant?: 'default' | 'outline';
  size?: 'default' | 'sm';
  className?: string;
}

/**
 * Action principale de `/applications` (spec §2) : ouvre le formulaire de
 * création manuelle (`?ajouter=1`). Extraite en composant parce qu'elle
 * apparaît à trois endroits (barre de filtres, état vide, en-tête mobile)
 * et doit garder partout le même libellé et la même icône.
 */
export function AddApplicationButton({ onClick, variant = 'default', size = 'default', className }: AddApplicationButtonProps) {
  return (
    <Button type="button" variant={variant} size={size} onClick={onClick} className={className}>
      <Plus aria-hidden="true" />
      Ajouter une candidature
    </Button>
  );
}
