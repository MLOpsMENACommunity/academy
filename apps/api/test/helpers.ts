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

import type { PrismaClient, Role } from '@prisma/client';
import type { INestApplication } from '@nestjs/common';
import { TokensService } from '../src/auth/tokens.service';

/** A verified user with a complete core profile, plus a session cookie for them. */
export async function createUser(
  app: INestApplication,
  prisma: PrismaClient,
  opts: { role?: Role; verified?: boolean; coreComplete?: boolean; prefix?: string } = {},
): Promise<{ id: string; email: string; cookie: string }> {
  const email = uniqueEmail(opts.prefix ?? 'user');
  const user = await prisma.user.create({
    data: {
      email,
      role: opts.role ?? 'STUDENT',
      emailVerifiedAt: opts.verified === false ? null : new Date(),
      profile: {
        create:
          opts.coreComplete === false
            ? {}
            : {
                fullNameEn: 'Test Person',
                phone: '+201001234567',
                country: 'EG',
                city: 'Cairo',
                timezone: 'Africa/Cairo',
                employmentStatus: 'EMPLOYED_FULL_TIME',
                jobTitle: 'Engineer',
                experienceYears: 'Y3_5',
                primaryArea: 'MLOPS',
                googleEmail: `g.${email}`,
                preferredLanguage: 'en',
                acceptedTermsAt: new Date(),
                coreCompletedAt: new Date(),
                completeness: 60,
              },
      },
    },
  });
  const cookie = `access_token=${await app.get(TokensService).signAccess(user)}`;
  return { id: user.id, email, cookie };
}

/** A throwaway OPEN course with one required yes/no question. */
export async function createCourse(
  prisma: PrismaClient,
  data: { type?: 'FREE' | 'PAID'; capacity?: number | null; requiresApproval?: boolean; price?: number } = {},
): Promise<{ id: string; slug: string; questionId: string }> {
  const slug = `test-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
  const course = await prisma.course.create({
    data: {
      slug,
      titleEn: 'Test course',
      titleAr: 'دورة تجريبية',
      shortDescriptionEn: 'x',
      shortDescriptionAr: 'x',
      longDescriptionEn: 'x',
      longDescriptionAr: 'x',
      type: data.type ?? 'FREE',
      price: data.price ?? 0,
      capacity: data.capacity ?? null,
      requiresApproval: data.requiresApproval ?? true,
      status: 'OPEN',
      targetAudience: { en: '', ar: '' },
      notFor: { en: '', ar: '' },
      learningOutcomes: { en: [], ar: [] },
      prerequisites: { en: [], ar: [] },
      outline: [],
      faq: [],
      included: { liveSessions: true, recordings: true, assignments: false, finalProject: false, certificate: false },
      screeningQuestions: { create: { type: 'YES_NO', labelEn: 'Committed?', labelAr: 'ملتزم؟', required: true } },
    },
    include: { screeningQuestions: true },
  });
  return { id: course.id, slug, questionId: course.screeningQuestions[0]!.id };
}
