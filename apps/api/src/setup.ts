import { INestApplication, ValidationPipe } from '@nestjs/common';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import cookieParser from 'cookie-parser';
import type { NextFunction, Request, Response } from 'express';
import { ENV } from './config/config.module';
import type { Env } from './config/env';

/** Shared by main.ts and the e2e tests so both run the same pipeline. */
const SAFE_METHODS = new Set(['GET', 'HEAD', 'OPTIONS']);

export function configureApp(app: NestExpressApplication): void {
  const env = app.get<Env>(ENV);
  // One proxy hop (Caddy in production, the Next /api proxy in dev) sets X-Forwarded-For.
  app.set('trust proxy', 1);
  app.setGlobalPrefix('api');
  // Only JSON bodies are parsed (multipart uploads go through multer per route).
  // A cross-site HTML form can't send JSON, so cookie-authenticated writes can't be forged.
  app.useBodyParser('json', { limit: '256kb' });
  app.use(cookieParser());

  // Defence in depth against CSRF: browsers send Origin / Sec-Fetch-Site on writes.
  const allowed = new Set(
    [env.WEB_URL, ...env.CORS_ORIGINS.split(',')].map((o) => o.trim()).filter(Boolean).map((o) => new URL(o).origin),
  );
  app.use((req: Request, res: Response, next: NextFunction) => {
    if (SAFE_METHODS.has(req.method)) return next();
    const site = req.headers['sec-fetch-site'];
    const origin = req.headers.origin;
    if (site === 'cross-site' || (origin && origin !== 'null' && !allowed.has(origin)) || origin === 'null') {
      res.status(403).json({ statusCode: 403, code: 'CROSS_SITE', message: 'Cross-site request blocked' });
      return;
    }
    next();
  });
  app.useGlobalPipes(
    new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }),
  );
}

export function setupSwagger(app: INestApplication): void {
  const config = new DocumentBuilder()
    .setTitle('MLOps MENA Academy API')
    .setDescription('REST API for academy.mlopsmena.com')
    .setVersion('1.0')
    .addCookieAuth('access_token')
    .build();
  SwaggerModule.setup('api/docs', app, SwaggerModule.createDocument(app, config));
}
