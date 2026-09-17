import { BadRequestException, ConflictException, NotFoundException } from '@nestjs/common';

/**
 * Erreurs du module « candidatures » (spec §6, tranche 6). Des fabriques d'exceptions Nest
 * plutôt que des classes métier : contrairement à l'adaptation de CV (appels Anthropic, dont
 * les erreurs remontent de services qui ne connaissent pas HTTP), tout ce module est un CRUD
 * dont chaque cas d'échec a un code HTTP unique et immédiat — le contrôleur n'a donc rien à
 * traduire, et le corps d'erreur (`{ code, message, details? }`) est celui que
 * `HttpExceptionFilter` renvoie tel quel.
 *
 * Messages en français accentué (jamais de détail technique, jamais le contenu d'une note).
 */

export const APPLICATION_NOT_FOUND_MESSAGE = 'Candidature introuvable.';
export const APPLICATION_EXISTS_MESSAGE = 'Une candidature existe déjà pour cette offre.';
export const JOB_NOT_FOUND_MESSAGE = 'Offre introuvable.';
export const RESUME_NOT_FOUND_MESSAGE = 'CV introuvable.';
export const LETTER_NOT_FOUND_MESSAGE = 'Lettre de motivation introuvable.';
export const VALIDATION_ERROR_MESSAGE = 'Certains champs sont invalides.';
export const CV_EXCLUSIVITY_MESSAGE = 'Choisissez soit le CV principal, soit un CV adapté.';

/** 404 — candidature absente **ou** appartenant à quelqu'un d'autre (spec §8 : jamais un 403). */
export function applicationNotFound(): NotFoundException {
  return new NotFoundException({ code: 'APPLICATION_NOT_FOUND', message: APPLICATION_NOT_FOUND_MESSAGE });
}

/** 404 — offre inconnue du catalogue (création depuis une offre). */
export function jobNotFound(): NotFoundException {
  return new NotFoundException({ code: 'JOB_NOT_FOUND', message: JOB_NOT_FOUND_MESSAGE });
}

/** 404 — CV adapté absent ou appartenant à quelqu'un d'autre. */
export function resumeNotFound(): NotFoundException {
  return new NotFoundException({ code: 'RESUME_NOT_FOUND', message: RESUME_NOT_FOUND_MESSAGE });
}

/** 404 — lettre absente ou appartenant à quelqu'un d'autre. */
export function letterNotFound(): NotFoundException {
  return new NotFoundException({ code: 'LETTER_NOT_FOUND', message: LETTER_NOT_FOUND_MESSAGE });
}

/**
 * 409 — une candidature existe déjà pour cette offre (`@@unique([userId, jobId])`, spec §5).
 * `details.applicationId` permet au web d'ouvrir la fiche existante plutôt que de réafficher
 * une erreur : c'est un identifiant de l'utilisateur lui-même, jamais celui d'un tiers.
 */
export function applicationExists(applicationId: string): ConflictException {
  return new ConflictException({
    code: 'APPLICATION_EXISTS',
    message: APPLICATION_EXISTS_MESSAGE,
    details: { applicationId },
  });
}

/**
 * 400 — « CV principal » et CV adapté demandés ensemble (spec §4/§5). Le `ZodValidationPipe`
 * refuse déjà le cas où les deux arrivent dans le même corps ; cette garde couvre l'appel
 * direct du service (tests unitaires, futur appelant interne) et la fusion d'un `PATCH`
 * partiel avec l'état déjà enregistré, que le schéma ne peut pas voir.
 */
export function cvExclusivityError(): BadRequestException {
  return new BadRequestException({
    code: 'VALIDATION_ERROR',
    message: VALIDATION_ERROR_MESSAGE,
    details: { resumeId: CV_EXCLUSIVITY_MESSAGE },
  });
}
