import { AlertCircle } from 'lucide-react';
import { Link } from 'react-router-dom';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { ApiError } from '@/services/api/client';

interface TailoringStatusProps {
  /** `BaseResumeDto.profileComplete` (spec §2/§7) : un profil trop vide désactive l'adaptation. */
  profileComplete: boolean;
  /** Erreur de la dernière tentative de `POST /resume/tailor`, ou `null`/`undefined` si aucune. */
  error: unknown;
  onRetry: () => void;
}

/**
 * État de l'adaptation IA (spec §2/§5/§7, étape 2 de la création) : profil
 * incomplet (bandeau + lien `/profile`, avant même de tenter l'appel), IA non
 * configurée (`ApiError.code === 'AI_NOT_CONFIGURED'`, 503 — jamais une
 * erreur bloquante : le CV principal reste téléchargeable), autre erreur
 * (message serveur + « Réessayer »), ou rien (pas de tentative en cours).
 */
export function TailoringStatus({ profileComplete, error, onRetry }: TailoringStatusProps) {
  if (!profileComplete) {
    return (
      <Alert>
        <AlertCircle aria-hidden="true" />
        <AlertTitle>Complétez votre profil pour adapter votre CV.</AlertTitle>
        <AlertDescription>
          <Link to="/profile" className="text-primary underline-offset-4 hover:underline">
            Compléter mon profil
          </Link>
        </AlertDescription>
      </Alert>
    );
  }

  if (!error) return null;

  const notConfigured = error instanceof ApiError && error.code === 'AI_NOT_CONFIGURED';
  if (notConfigured) {
    return (
      <Alert>
        <AlertCircle aria-hidden="true" />
        <AlertTitle>Le service IA n&apos;est pas configuré.</AlertTitle>
        <AlertDescription>Vous pouvez tout de même prévisualiser et télécharger votre CV principal.</AlertDescription>
      </Alert>
    );
  }

  const message = error instanceof ApiError ? error.message : 'Une erreur est survenue. Veuillez réessayer.';
  return (
    <Alert variant="destructive">
      <AlertCircle aria-hidden="true" />
      <AlertTitle>{message}</AlertTitle>
      <AlertDescription>
        <Button type="button" variant="outline" size="sm" onClick={onRetry}>
          Réessayer
        </Button>
      </AlertDescription>
    </Alert>
  );
}
