import type { FieldValues, Path, UseFormSetError } from 'react-hook-form';
import { ApiError } from '@/services/api/client';

const GENERIC_MESSAGE = 'Une erreur est survenue. Veuillez réessayer.';

/**
 * Message à afficher dans l'alerte générale du formulaire : le message
 * serveur tel quel pour un `ApiError` (identifiants invalides, limitation de
 * débit, service indisponible…), le contenu de `details.form` pour une
 * `VALIDATION_ERROR` qui ne cible aucun champ précis, ou un texte français
 * générique pour tout le reste (erreur réseau, exception inattendue…).
 * Toujours une chaîne : c'est à l'appelant de décider s'il doit l'afficher
 * (typiquement `mutation.isError && !applyFieldErrors(...)`).
 */
export function topLevelMessage(error: unknown): string {
  if (!(error instanceof ApiError)) return GENERIC_MESSAGE;
  if (error.code === 'VALIDATION_ERROR') return error.details?.form ?? GENERIC_MESSAGE;
  return error.message;
}

/**
 * Reporte les erreurs `VALIDATION_ERROR.details` connues sur les champs du
 * formulaire qui les concernent, via `setError`. On parcourt `fields` (pas
 * `details`) : une clé de `details` qui ne correspond à aucun champ déclaré
 * — un champ inconnu, ou la clé `form` réservée à l'alerte générale — est
 * donc silencieusement ignorée plutôt que reportée à l'aveugle.
 *
 * Renvoie `true` si au moins un champ a reçu une erreur : le signal pour
 * l'appelant de ne pas dupliquer le même message dans l'alerte générale
 * (voir `topLevelMessage`).
 */
export function applyFieldErrors<T extends FieldValues>(
  error: unknown,
  setError: UseFormSetError<T>,
  fields: readonly Path<T>[],
): boolean {
  if (!(error instanceof ApiError) || error.code !== 'VALIDATION_ERROR' || !error.details) {
    return false;
  }

  let applied = false;
  for (const field of fields) {
    const message = error.details[field];
    if (message) {
      setError(field, { message });
      applied = true;
    }
  }
  return applied;
}
