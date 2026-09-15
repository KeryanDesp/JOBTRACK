import cookie from '@fastify/cookie';
import helmet from '@fastify/helmet';
import { FastifyAdapter, type NestFastifyApplication } from '@nestjs/platform-fastify';
import { env } from './config/env';

/**
 * Applique à l'application toute la configuration transverse : sécurité HTTP,
 * cookies, CORS et préfixe d'API. Partagée entre le bootstrap réel et les
 * tests end-to-end, pour que les deux ne divergent jamais.
 */
export async function configureApp(app: NestFastifyApplication): Promise<void> {
  await app.register(helmet);
  await app.register(cookie, { secret: env.SESSION_SECRET });

  // CORS strictement limité à l'origine du frontend, cookies autorisés.
  app.enableCors({
    origin: env.WEB_ORIGIN,
    credentials: true,
  });

  app.setGlobalPrefix('api/v1');
}

export function createAdapter(): FastifyAdapter {
  // Ne faire confiance aux en-têtes X-Forwarded-* qu'en production, derrière
  // un vrai proxy. Sinon un client pourrait forger son IP et contourner le
  // rate limiting par adresse.
  return new FastifyAdapter({ trustProxy: env.NODE_ENV === 'production' });
}
