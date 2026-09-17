import { Info } from 'lucide-react';
import { Link } from 'react-router-dom';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';

interface IncompleteProfileNoticeProps {
  className?: string;
}

/**
 * Bandeau profil incomplet (spec §2 : sans compétence ni expérience, le score
 * n'est pas calculé). Les deux liens couvrent les deux façons de compléter le
 * profil (saisie manuelle ou import de CV) : ni l'un ni l'autre n'est
 * privilégié, l'utilisateur choisit.
 */
export function IncompleteProfileNotice({ className }: IncompleteProfileNoticeProps) {
  return (
    <Alert className={className}>
      <Info aria-hidden="true" />
      <AlertTitle>Complétez vos compétences et expériences pour obtenir un score fiable.</AlertTitle>
      <AlertDescription>
        <p>
          <Link to="/profile" className="text-primary underline-offset-4 hover:underline">
            Compléter mon profil
          </Link>
          {' · '}
          <Link to="/profile/import" className="text-primary underline-offset-4 hover:underline">
            Importer mon CV
          </Link>
        </p>
      </AlertDescription>
    </Alert>
  );
}
