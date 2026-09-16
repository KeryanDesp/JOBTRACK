import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import { useCvImport } from '@/features/cv-import/hooks/use-cv-import';
import { PreferencesForm } from '@/features/profile/components/preferences-form';

interface PreferencesStepProps {
  /** `null` si l'utilisateur n'a importé aucun CV (saisie manuelle, ou étape passée). */
  importId: string | null;
  onNext: () => void;
}

/**
 * Étape « Préférences » de l'accueil : le même formulaire que la carte du
 * profil, pré-rempli par les postes/lieux devinés lors de l'extraction du CV
 * quand un import a eu lieu — jamais rendu tant que ce brouillon est encore
 * en cours de chargement (`importId !== null && isPending`), pour ne pas
 * afficher le formulaire une première fois sans préremplissage puis le voir
 * changer sous les yeux de l'utilisateur. `PreferencesForm` n'est normalement
 * rendue que dans `<Card>` (voir `preferences-card.tsx`) : on reproduit ce
 * même habillage ici plutôt que de la laisser nue.
 */
export function PreferencesStep({ importId, onNext }: PreferencesStepProps) {
  const importQuery = useCvImport(importId);

  if (importId !== null && importQuery.isPending) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>Préférences de recherche</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <Skeleton className="h-9 w-full" />
          <Skeleton className="h-9 w-full" />
          <Skeleton className="h-9 w-full" />
        </CardContent>
      </Card>
    );
  }

  const extraction = importQuery.data?.extracted;

  return (
    <Card>
      <PreferencesForm submitLabel="Continuer" requireDirty={false} extraDefaults={extraction?.preferences} onSaved={onNext} />
    </Card>
  );
}
