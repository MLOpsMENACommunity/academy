import 'reflect-metadata';
import './load-env';
import './instrument';
import { ConsoleLogger, Logger } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { AppModule } from './app.module';
import { ENV } from './config/config.module';
import { loadEnv, type Env } from './config/env';
import { configureApp, setupSwagger } from './setup';

async function bootstrap(): Promise<void> {
  // JSON bodies only (see configureApp): no form-encoded bodies means no login CSRF via HTML forms.
  const boot = loadEnv();
  const json = boot.LOG_JSON ?? boot.NODE_ENV === 'production';
  const app = await NestFactory.create<NestExpressApplication>(AppModule, {
    bodyParser: false,
    logger: new ConsoleLogger({ json, colors: !json }),
  });
  const env = app.get<Env>(ENV);
  configureApp(app);
  const docs = setupSwagger(app);
  app.enableShutdownHooks();
  await app.listen(env.PORT);
  Logger.log(`API listening on :${env.PORT}${docs ? ' (docs at /api/docs)' : ''}`, 'Bootstrap');
}

// Any startup failure (bad config, database unreachable) must stop the process so
// the platform restarts it; don't rely on Node's default for unhandled rejections.
bootstrap().catch((err: unknown) => {
  Logger.error(`Startup failed: ${(err as Error)?.message ?? err}`, 'Bootstrap');
  process.exit(1);
});
