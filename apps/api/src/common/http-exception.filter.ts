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
 * Messages français pour les exceptions intégrées de Nest, qui n'ont pas de
 * `code` et portent un message technique en anglais (« Cannot GET /x »).
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

@Catch()
export class HttpExceptionFilter implements ExceptionFilter {
  private readonly logger = new Logger(HttpExceptionFilter.name);

  catch(exception: unknown, host: ArgumentsHost): void {
    const reply = host.switchToHttp().getResponse<FastifyReply>();
    const payload = this.toPayload(exception);

    if (payload.statusCode >= 500) {
      // Le détail technique reste dans les logs ; l'utilisateur reçoit un message neutre.
      this.logger.error(exception);
    }

    void reply.status(payload.statusCode).send(payload);
  }

  private toPayload(exception: unknown): ErrorPayload {
    if (!(exception instanceof HttpException)) return GENERIC;

    const statusCode = exception.getStatus();
    const response = exception.getResponse();

    // Corps déjà au format du projet : levé par notre code avec un message français.
    if (typeof response === 'object' && response !== null && 'code' in response) {
      const body = response as { code: string; message: string; details?: Record<string, string> };
      return { statusCode, ...body };
    }

    // Exception intégrée de Nest : message technique anglais, remplacé par statut.
    const known = BUILT_IN[statusCode];
    if (known) return { statusCode, ...known };

    return statusCode >= 500 ? GENERIC : { statusCode, code: 'HTTP_ERROR', message: 'Requête refusée.' };
  }
}
