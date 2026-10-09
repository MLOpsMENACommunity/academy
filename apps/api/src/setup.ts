import { INestApplication, ValidationPipe } from '@nestjs/common';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import cookieParser from 'cookie-parser';
import helmet from 'helmet';
import type { NextFunction, Request, Response } from 'express';
import { ENV } from './config/config.module';
import type { Env } from './config/env';
import { bodyParserErrors } from './common/exception.filter';
import { requestLog } from './common/request-log';

/** Shared by main.ts and the e2e tests so both run the same pipeline. */
const SAFE_METHODS = new Set(['GET', 'HEAD', 'OPTIONS']);

export function configureApp(app: NestExpressApplication): void {
  const env = app.get<Env>(ENV);
  // One proxy hop (Caddy in production, the Next /api proxy in dev) sets X-Forwarded-For.
  app.set('trust proxy', 1);
  app.setGlobalPrefix('api');
  // Only JSON bodies are parsed (multipart uploads go through multer per route).
  // A cross-site HTML form can't send JSON, so cookie-authenticated writes can't be forged.
  app.use(requestLog);
  // The API only returns JSON (and CSV/ICS downloads): nothing may run or be framed.
  // The Swagger UI (dev only, see setupSwagger) gets helmet's default policy instead.
  // HSTS matches the web pages (apps/web/next.config.ts): two years, subdomains, no preload.
  const hsts = { maxAge: 63_072_000, includeSubDomains: true, preload: false };
  const strict = helmet({
    contentSecurityPolicy: { useDefaults: false, directives: { defaultSrc: ["'none'"], frameAncestors: ["'none'"] } },
    crossOriginResourcePolicy: { policy: 'same-origin' },
    strictTransportSecurity: hsts,
  });
  const docs = helmet({ strictTransportSecurity: hsts });
  app.use((req: Request, res: Response, next: NextFunction) => (req.path.startsWith('/api/docs') ? docs : strict)(req, res, next));
  app.useBodyParser('json', { limit: '256kb' });
  // Malformed or oversized bodies get a generic message, not the parser's (exception.filter.ts).
  app.use(bodyParserErrors);
  app.use(cookieParser());

  const allowed = new Set(
    [env.WEB_URL, ...env.CORS_ORIGINS.split(',')].map((o) => o.trim()).filter(Boolean).map((o) => new URL(o).origin),
  );
  // Browsers reach the API same-origin through the web app; other origins must be listed explicitly.
  app.enableCors({ origin: [...allowed], credentials: true, maxAge: 600 });

  // Defence in depth against CSRF: browsers send Origin / Sec-Fetch-Site on writes.
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

/** API docs at /api/docs: on outside production, or with API_DOCS=true. */
export function setupSwagger(app: INestApplication): boolean {
  const env = app.get<Env>(ENV);
  if (env.NODE_ENV === 'production' && !env.API_DOCS) return false;
  const config = new DocumentBuilder()
    .setTitle('MLOps MENA Academy API')
    .setDescription('REST API for academy.mlopsmena.com')
    .setVersion('1.0')
    .addCookieAuth('access_token')
    .build();
  SwaggerModule.setup('api/docs', app, SwaggerModule.createDocument(app, config));
  return true;
}
