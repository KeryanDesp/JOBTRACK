import type { CvApplyResult } from '@jobtrack/shared';

const IMPORT_KEY = 'jobtrack-onboarding-import';
const RESULT_KEY = 'jobtrack-onboarding-result';

/**
 * Identifiant de l'import de CV en cours d'accueil, persisté en
 * `sessionStorage` (pas `localStorage` : ne doit pas survivre à la fermeture
 * de l'onglet) pour qu'un rechargement de `/onboarding/verification` ne
 * perde pas la référence au brouillon. Chaque accès est protégé : en
 * navigation privée stricte (ou quota dépassé), l'accès lève — l'accueil
 * reste alors utilisable, seule la persistance au rechargement est perdue.
 */
export function getOnboardingImportId(): string | null {
  try {
    return sessionStorage.getItem(IMPORT_KEY);
  } catch {
    return null;
  }
}

export function setOnboardingImportId(id: string): void {
  try {
    sessionStorage.setItem(IMPORT_KEY, id);
  } catch {
    // Voir le commentaire de `getOnboardingImportId`.
  }
}

export function clearOnboardingImportId(): void {
  try {
    sessionStorage.removeItem(IMPORT_KEY);
  } catch {
    // Voir le commentaire de `getOnboardingImportId`.
  }
}

/** Récapitulatif de la dernière application d'un brouillon, pour l'étape « Terminé ». */
export function getOnboardingResult(): CvApplyResult | null {
  try {
    const raw = sessionStorage.getItem(RESULT_KEY);
    if (!raw) return null;
    return JSON.parse(raw) as CvApplyResult;
  } catch {
    return null;
  }
}

export function setOnboardingResult(result: CvApplyResult): void {
  try {
    sessionStorage.setItem(RESULT_KEY, JSON.stringify(result));
  } catch {
    // Voir le commentaire de `getOnboardingImportId`.
  }
}

export function clearOnboardingResult(): void {
  try {
    sessionStorage.removeItem(RESULT_KEY);
  } catch {
    // Voir le commentaire de `getOnboardingImportId`.
  }
}
