import 'reflect-metadata';
import './load-env';
import { Logger } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';
import { ENV } from './config/config.module';
import type { Env } from './config/env';
import { configureApp, setupSwagger } from './setup';

async function bootstrap(): Promise<void> {
  const app = await NestFactory.create(AppModule);
  const env = app.get<Env>(ENV);
  configureApp(app);
  setupSwagger(app);
  app.enableShutdownHooks();
  await app.listen(env.PORT);
  Logger.log(`API listening on :${env.PORT} (docs at /api/docs)`, 'Bootstrap');
}

void bootstrap();
