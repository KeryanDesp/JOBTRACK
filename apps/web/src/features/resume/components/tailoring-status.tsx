import { AlertCircle } from 'lucide-react';
import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { ApiError } from '@/services/api/client';

// Le verrou serveur (`resume-tailoring.service.ts`, `LOCK_TTL_MS`) tient 5 minutes, mais un
// nouvel essai a de bonnes chances de reussir bien avant : 30 s de blocage cote client (revue
// finale) suffisent a empecher un « Réessayer » immediat de retomber sur le meme 409, sans faire
// attendre l'utilisateur aussi longtemps que le verrou lui-meme.
const RETRY_LOCK_MS = 30_000;

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
  const inProgress = error instanceof ApiError && error.code === 'TAILORING_IN_PROGRESS';
  const [retryLocked, setRetryLocked] = useState(inProgress);

  // Reverrouille a chaque nouvelle 409 (`error` change de reference a chaque tentative) — jamais
  // seulement au montage, sinon un second « Réessayer » rapide apres le deverrouillage ne
  // redeclencherait pas l'attente.
  useEffect(() => {
    if (!inProgress) return;
    setRetryLocked(true);
    const timeout = setTimeout(() => setRetryLocked(false), RETRY_LOCK_MS);
    return () => clearTimeout(timeout);
  }, [inProgress, error]);

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

  if (inProgress && error instanceof ApiError) {
    return (
      <Alert>
        <AlertCircle aria-hidden="true" />
        <AlertTitle>{error.message}</AlertTitle>
        <AlertDescription className="space-y-2">
          <p>Réessayez dans quelques minutes.</p>
          <Button type="button" variant="outline" size="sm" onClick={onRetry} disabled={retryLocked}>
            Réessayer
          </Button>
        </AlertDescription>
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
