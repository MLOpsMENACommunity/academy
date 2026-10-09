import 'reflect-metadata';
import './load-env';
import './instrument';
import { ConsoleLogger, Logger } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import type { NestExpressApplication } from '@nestjs/platform-express';
import type { Server } from 'node:http';
import { availableParallelism } from 'node:os';
import { getHeapStatistics } from 'node:v8';
import { AppModule } from './app.module';
import { ENV } from './config/config.module';
import { loadEnv, type Env } from './config/env';
import { loadEmailRenderer } from './email/email.service';
import { migrateOnStart } from './migrate-on-start';
import { configureApp, setupSwagger } from './setup';

/** Longest a shutdown (SIGTERM: deploy, sleep) waits for requests in progress before exiting anyway. */
const SHUTDOWN_GRACE_MS = 10_000;

/**
 * Process-level guards. An unhandled rejection is one failed promise (a fire-and-forget email,
 * an aborted request), not a corrupt process: it is logged (and reported to Sentry, see
 * instrument.ts), and the API keeps serving, because a restart costs every visitor seconds
 * of 503s. An uncaught exception may have left state half-updated, so that one still exits
 * and the platform restarts the container.
 */
function installProcessGuards(): void {
  const logger = new Logger('Process');
  process.on('unhandledRejection', (reason: unknown) => {
    logger.error({ event: 'unhandled_rejection', error: reason instanceof Error ? `${reason.name}: ${reason.message}` : String(reason) });
  });
  process.on('uncaughtException', (err: Error) => {
    logger.error({ event: 'uncaught_exception', error: `${err.name}: ${err.message}`, stack: err.stack });
    process.exit(1);
  });
}

async function bootstrap(): Promise<void> {
  installProcessGuards();
  // JSON bodies only (see configureApp): no form-encoded bodies means no login CSRF via HTML forms.
  const boot = loadEnv();
  // Schema first (the app's startup hooks already query it), and only when something is pending.
  if (process.env.RUN_MIGRATIONS === 'true') await migrateOnStart();
  const json = boot.LOG_JSON ?? boot.NODE_ENV === 'production';
  const app = await NestFactory.create<NestExpressApplication>(AppModule, {
    bodyParser: false,
    logger: new ConsoleLogger({ json, colors: !json }),
  });
  const env = app.get<Env>(ENV);
  configureApp(app);
  const docs = setupSwagger(app);

  // Graceful shutdown: stop accepting, let requests in progress finish (Nest closes the HTTP
  // server and the database pool), but never hang past SHUTDOWN_GRACE_MS.
  app.enableShutdownHooks();
  for (const signal of ['SIGTERM', 'SIGINT'] as const) {
    process.once(signal, () => {
      Logger.log(`${signal}: shutting down`, 'Bootstrap');
      setTimeout(() => process.exit(0), SHUTDOWN_GRACE_MS).unref();
    });
  }

  await app.listen(env.PORT);
  const server = app.getHttpServer() as Server;
  // The Worker keeps connections to the container open; let idle ones live a little longer than
  // its own keep-alive so the server never closes a socket the Worker is about to reuse.
  server.keepAliveTimeout = 65_000;
  server.headersTimeout = 66_000;
  // Nothing legitimate takes this long; a stuck request is cut off instead of holding memory.
  server.requestTimeout = 120_000;

  // The email renderer loads lazily (email.service.ts); warm it once serving has settled.
  setTimeout(() => void loadEmailRenderer().catch(() => undefined), 20_000).unref();

  const heapMb = Math.round(getHeapStatistics().heap_size_limit / 1024 / 1024);
  Logger.log(
    `API listening on :${env.PORT}${docs ? ' (docs at /api/docs)' : ''}; ${availableParallelism()} CPU(s) visible, heap limit ${heapMb} MB` +
      `${env.ACADEMY_RELEASE ? `, release ${env.ACADEMY_RELEASE}` : ''}`,
    'Bootstrap',
  );
}

// Any startup failure (bad config, database unreachable) must stop the process so
// the platform restarts it; don't rely on Node's default for unhandled rejections.
bootstrap().catch((err: unknown) => {
  Logger.error(`Startup failed: ${(err as Error)?.message ?? err}`, 'Bootstrap');
  process.exit(1);
});
