import type { CvImportDto } from '@jobtrack/shared';
import { AlertCircle, Loader2 } from 'lucide-react';
import { useState } from 'react';
import { ErrorState } from '@/components/shared/error-state';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { ServerErrorAlert } from '@/features/auth/components/server-error-alert';
import { topLevelMessage } from '@/features/auth/lib/form-errors';
import { CvDropzone } from '@/features/cv-import/components/cv-dropzone';
import { useCvCapabilities, useRetryCvImport, useUploadCv } from '@/features/cv-import/hooks/use-cv-import';

interface CvStepProps {
  /** Brouillon extrait avec succès : l'appelant range l'identifiant et passe à la vérification. */
  onExtracted: (importId: string) => void;
  /** L'IA n'est pas disponible, ou l'utilisateur préfère saisir son profil lui-même. */
  onManual: () => void;
}

/**
 * Étape « Importer un CV » de l'accueil. `POST /cv-imports` extrait de façon
 * synchrone côté serveur : une fois l'envoi terminé (`progress` à 1), la
 * réponse peut encore prendre plusieurs secondes — d'où l'état « Analyse en
 * cours… » distinct de la barre de progression de l'envoi lui-même.
 */
export function CvStep({ onExtracted, onManual }: CvStepProps) {
  const capabilities = useCvCapabilities();
  const upload = useUploadCv();
  const retry = useRetryCvImport();
  const [failed, setFailed] = useState<CvImportDto | null>(null);

  async function handleSelect(file: File): Promise<void> {
    setFailed(null);
    try {
      const result = await upload.mutateAsync(file);
      if (result.status === 'EXTRACTED') {
        onExtracted(result.id);
      } else {
        setFailed(result);
      }
    } catch {
      // Erreur déjà exposée via `upload.error` (annulation filtrée par `useUploadCv`).
    }
  }

  async function handleRetry(): Promise<void> {
    if (!failed) return;
    try {
      const result = await retry.mutateAsync(failed.id);
      if (result.status === 'EXTRACTED') {
        onExtracted(result.id);
      } else {
        setFailed(result);
      }
    } catch {
      // Erreur déjà exposée via `retry.error`.
    }
  }

  function handleChooseAnother(): void {
    setFailed(null);
    upload.reset();
  }

  if (capabilities.isPending) {
    return (
      <div className="space-y-3">
        <Skeleton className="h-9 w-2/3" />
        <Skeleton className="h-40 w-full" />
      </div>
    );
  }

  if (capabilities.isError) {
    return (
      <ErrorState
        message="Impossible de vérifier la disponibilité de l'analyse. Réessayez."
        onRetry={() => void capabilities.refetch()}
      />
    );
  }

  if (!capabilities.data.ai) {
    return (
      <div className="space-y-4">
        <Alert>
          <AlertCircle />
          <AlertDescription>
            L'analyse automatique n'est pas disponible pour le moment (clé d'API absente). Vous pouvez remplir
            votre profil à la main.
          </AlertDescription>
        </Alert>
        <Button onClick={onManual}>Remplir à la main</Button>
      </div>
    );
  }

  if (failed) {
    return (
      <div className="space-y-4">
        <Alert variant="destructive">
          <AlertCircle />
          <AlertDescription>{failed.error ?? "Le document n'a pas pu être interprété."}</AlertDescription>
        </Alert>
        <ServerErrorAlert message={retry.error ? topLevelMessage(retry.error) : undefined} />
        <div className="flex flex-wrap gap-2">
          <Button onClick={() => void handleRetry()} disabled={retry.isPending}>
            {retry.isPending ? 'Nouvelle tentative…' : 'Réessayer'}
          </Button>
          <Button variant="outline" onClick={handleChooseAnother}>
            Choisir un autre fichier
          </Button>
        </div>
      </div>
    );
  }

  if (upload.isPending && upload.progress >= 1) {
    return (
      <div className="flex flex-col items-center gap-3 py-10 text-center">
        <Loader2 className="text-primary size-6 animate-spin" aria-hidden />
        <p className="text-sm font-medium">Analyse en cours…</p>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <CvDropzone
        isUploading={upload.isPending}
        progress={upload.progress}
        maxSizeBytes={capabilities.data.maxSizeBytes}
        onSelect={(file) => void handleSelect(file)}
        onCancelUpload={upload.abort}
      />
      <ServerErrorAlert message={upload.error ? topLevelMessage(upload.error) : undefined} />
      <p className="text-center">
        <button
          type="button"
          className="text-muted-foreground text-sm underline-offset-4 hover:underline"
          onClick={onManual}
        >
          Je remplirai mon profil à la main
        </button>
      </p>
    </div>
  );
}
