import type { JobSourceKind } from '@prisma/client';

/**
 * Erreurs communes à tous les connecteurs de sources d'offres (France Travail
 * aujourd'hui, d'autres demain — spec §4 et §8). Les messages sont toujours en
 * français et ne contiennent jamais de secret (identifiants, jeton) ni de
 * contenu d'offre : seulement le type de source et, au mieux, un code d'erreur
 * générique renvoyé par la source elle-même.
 */
export abstract class JobSourceError extends Error {
  constructor(readonly kind: JobSourceKind, message: string) {
    super(message);
    this.name = this.constructor.name;
  }
}

/** Aucun identifiant configuré pour cette source : le connecteur n'existe pas. */
export class SourceNotConfiguredError extends JobSourceError {
  constructor(kind: JobSourceKind) {
    super(kind, `Le connecteur ${kind} n'est pas configuré (identifiants absents).`);
  }
}

/** Identifiants invalides, jeton refusé, ou souscription insuffisante (401/403). */
export class SourceAuthError extends JobSourceError {
  constructor(kind: JobSourceKind) {
    super(kind, `Authentification refusée par la source ${kind} (identifiants ou souscription invalides).`);
  }
}

/** Panne réseau, délai dépassé, réponse 5xx, ou requête refusée (400) par la source. */
export class SourceUnavailableError extends JobSourceError {
  constructor(kind: JobSourceKind, message = `La source ${kind} est momentanément indisponible.`) {
    super(kind, message);
  }
}

/** Quota ou débit dépassé (429) et non résorbé après nouvelle tentative. */
export class SourceRateLimitedError extends JobSourceError {
  constructor(kind: JobSourceKind) {
    super(kind, `Trop d'appels vers la source ${kind} : limite de débit atteinte.`);
  }
}
