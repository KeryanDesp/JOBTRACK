/**
 * Erreurs métier de `CvExtractionService`, distinctes des exceptions HTTP Nest :
 * le contrôleur (tâche 5) les mappe vers les codes/statuts de la spec (§5), ce
 * service n'a pas à connaître Nest.
 */

/** Document trop volumineux (taille brute ou nombre de tokens d'entrée) pour être analysé. */
export class CvTooLongError extends Error {
  readonly code = 'CV_TOO_LONG';

  constructor() {
    super('Ce document est trop long pour être analysé.');
    this.name = 'CvTooLongError';
  }
}

/** Document illisible : pas de texte exploitable, refus du modèle, ou sortie non interprétable. */
export class CvUnreadableError extends Error {
  readonly code = 'CV_UNREADABLE';

  constructor(message: string) {
    super(message);
    this.name = 'CvUnreadableError';
  }
}

/** Aucune clé Anthropic configurée : le service d'extraction est désactivé. */
export class AiNotConfiguredError extends Error {
  readonly code = 'AI_NOT_CONFIGURED';

  constructor() {
    super("Le service d'analyse de CV n'est pas configuré.");
    this.name = 'AiNotConfiguredError';
  }
}

/** Anthropic a répondu par une erreur transitoire (quota, panne, réseau) : réessayer plus tard. */
export class AiUnavailableError extends Error {
  readonly code = 'AI_UNAVAILABLE';

  constructor() {
    super("Le service d'analyse est momentanément indisponible. Réessayez dans quelques minutes.");
    this.name = 'AiUnavailableError';
  }
}
