import { HttpException, HttpStatus } from '@nestjs/common';

/** Réponse unique quand une dépendance (Redis) ne répond pas : le frontend a un seul signal de réessai. */
export function serviceUnavailable(): HttpException {
  return new HttpException(
    { code: 'SERVICE_UNAVAILABLE', message: 'Service temporairement indisponible. Réessayez dans un instant.' },
    HttpStatus.SERVICE_UNAVAILABLE,
  );
}
