import type { NestExpressApplication } from '@nestjs/platform-express';
import request from 'supertest';
import { createTestApp } from './helpers';

describe('internal jobs endpoint (e2e)', () => {
  let app: NestExpressApplication;
  const token = 'j'.repeat(40);

  beforeAll(async () => {
    process.env.JOBS_TOKEN = token;
    ({ app } = await createTestApp());
  });
  afterAll(async () => {
    delete process.env.JOBS_TOKEN;
    await app.close();
  });

  it('requires the shared token', async () => {
    await request(app.getHttpServer()).post('/api/internal/jobs/tick').expect(401);
    await request(app.getHttpServer()).post('/api/internal/jobs/tick').set('x-jobs-token', 'wrong').expect(401);
  });

  it('runs every job once and reports counts', async () => {
    const res = await request(app.getHttpServer()).post('/api/internal/jobs/tick').set('x-jobs-token', token).expect(200);
    expect(res.body).toEqual({
      announcementEmailsPending: expect.any(Number),
      eventRemindersSent: expect.any(Number),
      anonymised: expect.any(Number),
      profileReviewEmails: expect.any(Number),
      screenshotsDeleted: expect.any(Number),
      cvsDeleted: expect.any(Number),
      remindersSent: expect.any(Number),
      assessmentRemindersSent: expect.any(Number),
      submissionFilesDeleted: expect.any(Number),
    });
  });
});
