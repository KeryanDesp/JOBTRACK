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
 * (`stop_reason === 'max_tokens'`) ou refus (`stop_reason === 'refusal'`) — y compris une sortie
 * qui ne respecte plus le schéma une fois ancrée/assainie (ex. un champ requis réduit à des
 * caractères de contrôle, revue sécurité tâche 5). Jamais écrite en base : `ResumeService`/
 * `CoverLetterStoreService` n'écrivent qu'après un résultat exploitable. Le contrôleur la mappe
 * en 502 `AI_OUTPUT_INVALID`. Le message ne révèle jamais la cause exacte (peut porter un
 * fragment de la sortie du modèle) — seuls les journaux (jobId, classe d'erreur) le font.
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

export const RESUME_NOT_FOUND_MESSAGE = 'CV introuvable.';

export const RATE_LIMITED_MESSAGE = 'Trop de tentatives. Réessayez dans quelques minutes.';

/**
 * Budget épuisé (spec §5/§8) : compté manuellement par `ResumeTailoringService`/
 * `CoverLetterService` juste avant l'appel Claude (revue sécurité, tâche 5) — jamais par une
 * garde posée sur la route (`UserRateLimitGuard`), qui consommerait le budget avant même les
 * contrôles offre/profil/verrou (une 404/409/503 ne coûtait alors jamais rien de moins qu'une
 * tentative complète). Le contrôleur la mappe en 429 `RATE_LIMITED`.
 */
export class RateLimitedError extends Error {
  readonly code = 'RATE_LIMITED';

  constructor() {
    super(RATE_LIMITED_MESSAGE);
    this.name = 'RateLimitedError';
  }
}
