import {
  Catch,
  HttpException,
  HttpStatus,
  Logger,
  type ArgumentsHost,
  type ExceptionFilter,
} from '@nestjs/common';
import type { FastifyReply } from 'fastify';

interface ErrorPayload {
  statusCode: number;
  code: string;
  message: string;
  details?: Record<string, string>;
}

/**
 * Messages français par statut pour les erreurs qui n'ont pas de `code` :
 * exceptions intégrées de Nest (« Cannot GET /x ») et erreurs levées par
 * Fastify lui-même (corps trop volumineux, type de contenu refusé).
 */
const BUILT_IN: Record<number, { code: string; message: string }> = {
  400: { code: 'BAD_REQUEST', message: 'Requête invalide.' },
  401: { code: 'UNAUTHORIZED', message: 'Authentification requise.' },
  403: { code: 'FORBIDDEN', message: 'Accès refusé.' },
  404: { code: 'NOT_FOUND', message: 'Ressource introuvable.' },
  405: { code: 'METHOD_NOT_ALLOWED', message: 'Méthode non autorisée.' },
  409: { code: 'CONFLICT', message: 'Conflit avec une ressource existante.' },
  413: { code: 'PAYLOAD_TOO_LARGE', message: 'Le contenu envoyé est trop volumineux.' },
  415: { code: 'UNSUPPORTED_MEDIA_TYPE', message: 'Format de contenu non pris en charge.' },
  429: { code: 'RATE_LIMITED', message: 'Trop de tentatives. Réessayez dans quelques minutes.' },
};

const GENERIC: ErrorPayload = {
  statusCode: HttpStatus.INTERNAL_SERVER_ERROR,
  code: 'INTERNAL_ERROR',
  message: 'Une erreur est survenue. Veuillez réessayer.',
};

/** Statuts 4xx dignes d'une trace : tentatives d'accès et limitation de débit. */
const WARNED_STATUSES = new Set([401, 403, 429]);

function knownClientError(statusCode: number): ErrorPayload {
  const known = BUILT_IN[statusCode];
  return known ? { statusCode, ...known } : { statusCode, code: 'HTTP_ERROR', message: 'Requête refusée.' };
}

@Catch()
export class HttpExceptionFilter implements ExceptionFilter {
  private readonly logger = new Logger(HttpExceptionFilter.name);

  catch(exception: unknown, host: ArgumentsHost): void {
    const reply = host.switchToHttp().getResponse<FastifyReply>();
    const payload = this.toPayload(exception);

    if (payload.statusCode >= 500) {
      // Le détail technique reste dans les logs ; l'utilisateur reçoit un message neutre.
      // Deux arguments : sans la pile en second, le Logger de Nest n'imprime qu'une ligne.
      const error = exception instanceof Error ? exception : new Error(String(exception));
      this.logger.error(error.message, error.stack);
    } else if (WARNED_STATUSES.has(payload.statusCode)) {
      this.logger.warn(`${payload.statusCode} ${payload.code}`);
    }

    void reply.status(payload.statusCode).send(payload);
  }

  private toPayload(exception: unknown): ErrorPayload {
    if (!(exception instanceof HttpException)) {
      // Erreur levée par Fastify avant Nest (413, 415…) : un `statusCode` numérique
      // sans HttpException. La traiter comme inattendue en ferait un faux 500.
      const statusCode = (exception as { statusCode?: unknown } | null)?.statusCode;
      if (typeof statusCode === 'number' && statusCode >= 400 && statusCode < 500) {
        return knownClientError(statusCode);
      }
      return GENERIC;
    }

    const statusCode = exception.getStatus();
    const response = exception.getResponse();

    // Corps déjà au format du projet : levé par notre code avec un message français.
    if (typeof response === 'object' && response !== null && 'code' in response) {
      const body = response as { code: string; message: string; details?: Record<string, string> };
      return { statusCode, ...body };
    }

    return statusCode >= 500 ? GENERIC : knownClientError(statusCode);
  }
}
