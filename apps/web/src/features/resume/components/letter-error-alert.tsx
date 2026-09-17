import { AlertCircle } from 'lucide-react';
import { Link } from 'react-router-dom';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { ApiError } from '@/services/api/client';

export interface LetterErrorAlertProps {
  /** Typiquement `mutation.error` d'`useCreateLetter` — `null`/`undefined` : rien n'est affiché. */
  error: unknown;
}

/**
 * Message lisible pour une erreur de génération/régénération de lettre (spec
 * §2/§5, tâche 8), partagé entre `GenerationPanel` (aucune lettre encore) et
 * la carte « Régénérer avec un autre ton » (`cover-letter-page.tsx`) : sans ce
 * composant commun, la seconde n'affichait jamais `AI_NOT_CONFIGURED` /
 * `PROFILE_INCOMPLETE` / `RATE_LIMITED` malgré leurs toasts volontairement
 * supprimés par `useCreateLetter` (`isSilentTailoringError`) — l'échec passait
 * alors totalement inaperçu.
 */
export function LetterErrorAlert({ error }: LetterErrorAlertProps) {
  if (error === null || error === undefined) return null;

  const code = error instanceof ApiError ? error.code : undefined;

  if (code === 'AI_NOT_CONFIGURED') {
    return (
      <Alert>
        <AlertCircle aria-hidden="true" />
        <AlertTitle>Le service IA n&apos;est pas configuré.</AlertTitle>
      </Alert>
    );
  }

  if (code === 'PROFILE_INCOMPLETE') {
    return (
      <Alert>
        <AlertCircle aria-hidden="true" />
        <AlertTitle>Complétez votre profil pour générer une lettre.</AlertTitle>
        <AlertDescription>
          <Link to="/profile" className="text-primary underline-offset-4 hover:underline">
            Compléter mon profil
          </Link>
        </AlertDescription>
      </Alert>
    );
  }

  if (code === 'RATE_LIMITED') {
    return (
      <Alert variant="destructive">
        <AlertCircle aria-hidden="true" />
        <AlertTitle>{error instanceof ApiError ? error.message : 'Trop de générations récentes. Réessayez plus tard.'}</AlertTitle>
      </Alert>
    );
  }

  return (
    <Alert variant="destructive">
      <AlertCircle aria-hidden="true" />
      <AlertTitle>{error instanceof ApiError ? error.message : 'Une erreur est survenue. Veuillez réessayer.'}</AlertTitle>
    </Alert>
  );
}
