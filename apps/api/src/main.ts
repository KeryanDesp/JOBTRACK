import 'reflect-metadata';
import cookie from '@fastify/cookie';
import helmet from '@fastify/helmet';
import { Logger } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { FastifyAdapter, type NestFastifyApplication } from '@nestjs/platform-fastify';
import { AppModule } from './app.module';
import { env } from './config/env';

async function bootstrap(): Promise<void> {
  const app = await NestFactory.create<NestFastifyApplication>(
    AppModule,
    new FastifyAdapter({ trustProxy: true }),
  );

  await app.register(helmet);
  await app.register(cookie, { secret: env.SESSION_SECRET });

  // CORS strictement limité à l'origine du frontend, cookies autorisés.
  app.enableCors({
    origin: env.WEB_ORIGIN,
    credentials: true,
  });

  app.setGlobalPrefix('api/v1');

  await app.listen({ port: env.API_PORT, host: '0.0.0.0' });
  Logger.log(`API démarrée sur http://localhost:${env.API_PORT}/api/v1`, 'Bootstrap');
}

void bootstrap();
