import { INestApplication, ValidationPipe } from '@nestjs/common';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import cookieParser from 'cookie-parser';

/** Shared by main.ts and the e2e tests so both run the same pipeline. */
export function configureApp(app: NestExpressApplication): void {
  // One proxy hop (Caddy in production, the Next /api proxy in dev) sets X-Forwarded-For.
  app.set('trust proxy', 1);
  app.setGlobalPrefix('api');
  app.use(cookieParser());
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
