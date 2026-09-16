import type { CvApplyFormInput, CvApplyResult } from '@jobtrack/shared';
import { AlertCircle, Loader2 } from 'lucide-react';
import { toast } from 'sonner';
import { ErrorState } from '@/components/shared/error-state';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { useApplyCvImport, useCvImport, useRetryCvImport } from '../hooks/use-cv-import';
import { ExtractionReview } from './extraction-review';

export interface CvImportReviewProps {
  importId: string;
  onApplied: (result: CvApplyResult) => void;
  /** « Choisir un autre fichier » (échec, ou extraction vide) : abandonne ce brouillon. */
  onBack: () => void;
}

/** Résultat neutre : rien n'a réellement été appliqué (« Continuer sans importer »). */
const EMPTY_APPLY_RESULT: CvApplyResult = {
  created: { experiences: 0, educations: 0, skills: 0, languages: 0, certifications: 0, projects: 0 },
};

/**
 * Étape « Vérifier » d'un import de CV, quel que soit le point d'entrée
 * (accueil via `onboarding/steps/review-step.tsx`, ou import direct depuis le
 * profil via `pages/import-cv-page.tsx`) : charge le brouillon (`useCvImport`,
 * qui sonde tant que le statut reste `PENDING`), puis affiche l'état qui
 * convient — chargement, erreur, analyse en cours, échec avec réessai, ou la
 * revue elle-même (`ExtractionReview`).
 */
export function CvImportReview({ importId, onApplied, onBack }: CvImportReviewProps) {
  const importQuery = useCvImport(importId);
  const applyMutation = useApplyCvImport();
  const retryMutation = useRetryCvImport();

  function handleSubmit(body: CvApplyFormInput): void {
    applyMutation.mutate(
      { id: importId, body },
      {
        onSuccess: (result) => {
          toast.success('Profil mis à jour.');
          onApplied(result);
        },
      },
    );
  }

  if (importQuery.isPending) {
    return (
      <div className="space-y-3">
        <Skeleton className="h-9 w-2/3" />
        <Skeleton className="h-40 w-full" />
      </div>
    );
  }

  if (importQuery.isError) {
    return (
      <ErrorState message="Impossible de charger le brouillon extrait." onRetry={() => void importQuery.refetch()} />
    );
  }

  const dto = importQuery.data;

  if (dto.status === 'PENDING') {
    return (
      <div className="flex flex-col items-center gap-3 py-10 text-center">
        <Loader2 className="text-primary size-6 animate-spin" aria-hidden />
        <p className="text-sm font-medium">Analyse en cours…</p>
      </div>
    );
  }

  if (dto.status === 'FAILED') {
    return (
      <div className="space-y-4">
        <Alert variant="destructive">
          <AlertCircle />
          <AlertDescription>{dto.error ?? "Le document n'a pas pu être interprété."}</AlertDescription>
        </Alert>
        <div className="flex flex-wrap gap-2">
          <Button onClick={() => retryMutation.mutate(importId)} disabled={retryMutation.isPending}>
            {retryMutation.isPending ? 'Nouvelle tentative…' : 'Réessayer'}
          </Button>
          <Button variant="outline" onClick={onBack}>
            Choisir un autre fichier
          </Button>
        </div>
      </div>
    );
  }

  if (dto.status === 'APPLIED') {
    return (
      <div className="space-y-4 text-center">
        <p className="text-muted-foreground text-sm">Ce CV a déjà été appliqué à votre profil.</p>
        <Button onClick={() => onApplied(EMPTY_APPLY_RESULT)}>Continuer</Button>
      </div>
    );
  }

  if (!dto.extracted) {
    // Ne devrait pas arriver (`EXTRACTED` porte toujours un brouillon) : traité comme
    // un échec de chargement plutôt qu'un écran vide silencieux.
    return <ErrorState message="Ce brouillon n'est plus disponible." onRetry={onBack} />;
  }

  return (
    <ExtractionReview
      extraction={dto.extracted}
      onSubmit={handleSubmit}
      isPending={applyMutation.isPending}
      error={applyMutation.error}
      onBack={onBack}
      onSkip={() => onApplied(EMPTY_APPLY_RESULT)}
    />
  );
}
