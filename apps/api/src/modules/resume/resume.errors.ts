/**
 * Erreurs métier de `ResumeTailoringService`/`CoverLetterService`.
 * `AiNotConfiguredError`/`AiUnavailableError` sont celles de l'extraction de
 * CV (tranche 2), déjà réutilisées par l'analyse d'offre (tranche 4) : mêmes
 * causes (clé absente/révoquée, panne transitoire Anthropic), même contrat
 * pour l'appelant — pas de duplication.
 */
export { AiNotConfiguredError, AiUnavailableError } from '../cv-import/cv-extraction.errors';

export const AI_OUTPUT_INVALID_MESSAGE = 'La réponse du service IA est inexploitable. Réessayez.';

/**
 * Sortie du modèle inexploitable : schéma non respecté, sortie tronquée
 * (`stop_reason === 'max_tokens'`) ou refus (`stop_reason === 'refusal'`).
 * Jamais écrite en base (aucune persistance dans cette tranche) ; le
 * contrôleur (tâche 5) la mappe en 502 `AI_OUTPUT_INVALID`. Le message ne
 * révèle jamais la cause exacte (peut porter un fragment de la sortie du
 * modèle) — seuls les journaux (jobId, classe d'erreur) le font.
 */
export class AiOutputInvalidError extends Error {
  readonly code = 'AI_OUTPUT_INVALID';

  constructor() {
    super(AI_OUTPUT_INVALID_MESSAGE);
    this.name = 'AiOutputInvalidError';
  }
}

export const PROFILE_INCOMPLETE_MESSAGE =
  'Complétez votre profil (au moins une expérience ou une compétence) avant de générer un CV.';

/** Profil absent, ou sans aucune expérience ni compétence : rien d'exploitable à adapter. */
export class ProfileIncompleteError extends Error {
  readonly code = 'PROFILE_INCOMPLETE';

  constructor() {
    super(PROFILE_INCOMPLETE_MESSAGE);
    this.name = 'ProfileIncompleteError';
  }
}
