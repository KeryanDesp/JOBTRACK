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
 * quand un import a eu lieu. `extraction.preferences` est passé tel quel
 * (référence stable tant que la requête ne change pas) : `PreferencesForm`
 * en dépend directement dans son effet de préremplissage.
 */
export function PreferencesStep({ importId, onNext }: PreferencesStepProps) {
  const importQuery = useCvImport(importId);
  const extraction = importQuery.data?.extracted;

  return <PreferencesForm submitLabel="Continuer" requireDirty={false} extraDefaults={extraction?.preferences} onSaved={onNext} />;
}
