/**
 * Étapes de l'accueil et leur ordre, dans l'URL (`/onboarding/{clé}`) comme
 * dans `StepIndicator`. Source unique pour les deux : ajouter une étape ne
 * demande de modifier qu'ici.
 */
export const ONBOARDING_STEPS = [
  { key: 'bienvenue', label: 'Bienvenue' },
  { key: 'cv', label: 'CV' },
  { key: 'verification', label: 'Vérifier' },
  { key: 'preferences', label: 'Préférences' },
  { key: 'fin', label: 'Terminé' },
] as const;

export type OnboardingStep = (typeof ONBOARDING_STEPS)[number]['key'];

export function isOnboardingStep(value: string): value is OnboardingStep {
  return ONBOARDING_STEPS.some((step) => step.key === value);
}
