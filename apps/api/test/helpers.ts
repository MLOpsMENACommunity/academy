import { Test } from '@nestjs/testing';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { AppModule } from '../src/app.module';
import { PrismaService } from '../src/prisma/prisma.service';
import { configureApp } from '../src/setup';

/** Boots the real app against DATABASE_URL with emails logged and jobs off. */
export async function createTestApp(): Promise<{ app: NestExpressApplication; prisma: PrismaService }> {
  process.env.EMAIL_PROVIDER = 'log';
  process.env.JOBS_ENABLED = 'false';
  process.env.S3_CREATE_BUCKET = 'false';
  const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
  const app = moduleRef.createNestApplication<NestExpressApplication>({ logger: ['error'], bodyParser: false });
  configureApp(app);
  await app.init();
  return { app, prisma: app.get(PrismaService) };
}

export function uniqueEmail(prefix = 'e2e'): string {
  return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}@example.test`;
}

/** Extracts cookies from a supertest response into a Cookie header value. */
export function cookieHeader(setCookie: string[] | string | undefined, prev = ''): string {
  const jar = new Map(
    prev
      .split('; ')
      .filter(Boolean)
      .map((c) => c.split('=') as [string, string]),
  );
  for (const c of ([] as string[]).concat(setCookie ?? [])) {
    const [pair] = c.split(';');
    const [name, value] = pair!.split('=') as [string, string];
    if (value === '' || /Expires=Thu, 01 Jan 1970/.test(c)) jar.delete(name);
    else jar.set(name, value);
  }
  return [...jar].map(([k, v]) => `${k}=${v}`).join('; ');
}
