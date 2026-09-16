import 'reflect-metadata';
import { Logger } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import type { NestFastifyApplication } from '@nestjs/platform-fastify';
import { AppModule } from './app.module';
import { configureApp, createAdapter } from './app.setup';
import { env } from './config/env';

async function bootstrap(): Promise<void> {
  const app = await NestFactory.create<NestFastifyApplication>(AppModule, createAdapter());
  await configureApp(app);

  await app.listen({ port: env.API_PORT, host: '0.0.0.0' });
  Logger.log(`API démarrée sur http://localhost:${env.API_PORT}/api/v1`, 'Bootstrap');

  // Jamais la clé elle-même : seulement si le service IA est disponible.
  Logger.log(
    env.ANTHROPIC_API_KEY
      ? 'Service IA : configuré'
      : 'Service IA : non configuré (ANTHROPIC_API_KEY absente)',
    'Bootstrap',
  );
}

void bootstrap();
