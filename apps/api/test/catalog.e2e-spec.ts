import type { NestExpressApplication } from '@nestjs/platform-express';
import request from 'supertest';
import { PrismaService } from '../src/prisma/prisma.service';
import { createTestApp } from './helpers';

describe('public catalog (e2e)', () => {
  let app: NestExpressApplication;
  let prisma: PrismaService;
  const http = () => request(app.getHttpServer());
  const slugs: Record<string, string> = {};

  beforeAll(async () => {
    ({ app, prisma } = await createTestApp());
    for (const status of ['DRAFT', 'ARCHIVED', 'OPEN'] as const) {
      const slug = `vis-${status.toLowerCase()}-${Date.now()}`;
      slugs[status] = slug;
      await prisma.course.create({
        data: {
          slug,
          titleEn: status,
          titleAr: status,
          shortDescriptionEn: 'x',
          shortDescriptionAr: 'x',
          longDescriptionEn: 'x',
          longDescriptionAr: 'x',
          type: 'PAID',
          status,
          driveFolderUrl: 'https://drive.google.com/drive/folders/SECRET',
          targetAudience: { en: '', ar: '' },
          notFor: { en: '', ar: '' },
          learningOutcomes: { en: [], ar: [] },
          prerequisites: { en: [], ar: [] },
          outline: [],
          faq: [],
          included: {},
          sessions: { create: { order: 1, titleEn: 's', titleAr: 's', startsAt: new Date(), liveUrl: 'https://meet.google.com/SECRET' } },
        },
      });
    }
  });
  afterAll(async () => {
    await app.close();
  });

  it('hides draft and archived courses from detail, list and slugs', async () => {
    await http().get(`/api/courses/${slugs.DRAFT}`).expect(404);
    await http().get(`/api/courses/${slugs.ARCHIVED}`).expect(404);
    await http().get(`/api/courses/${slugs.OPEN}`).expect(200);
    const list = (await http().get('/api/courses').expect(200)).body as { slug: string }[];
    const listed = list.map((c) => c.slug);
    expect(listed).toContain(slugs.OPEN);
    expect(listed).not.toContain(slugs.DRAFT);
    expect(listed).not.toContain(slugs.ARCHIVED);
    const s = ((await http().get('/api/courses/slugs').expect(200)).body as { slug: string }[]).map((x) => x.slug);
    expect(s).not.toContain(slugs.DRAFT);
  });

  it('never returns private links in public responses', async () => {
    const detail = await http().get(`/api/courses/${slugs.OPEN}`).expect(200);
    const list = await http().get('/api/courses').expect(200);
    expect(JSON.stringify(detail.body) + JSON.stringify(list.body)).not.toMatch(/SECRET/);
  });

  it('requires sign-in for my-status', async () => {
    await http().get(`/api/courses/${slugs.OPEN}/my-status`).expect(401);
  });

  it('validates catalog filters', async () => {
    await http().get('/api/courses?level=NOPE').expect(400);
    await http().get('/api/courses?type=FREE&availability=OPEN').expect(200);
  });
});
