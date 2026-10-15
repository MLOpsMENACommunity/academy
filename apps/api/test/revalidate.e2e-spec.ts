import { createServer, type IncomingHttpHeaders, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import type { NestExpressApplication } from '@nestjs/platform-express';
import request from 'supertest';
import { PublicRevalidator } from '../src/common/revalidate';
import { PrismaService } from '../src/prisma/prisma.service';
import { createTestApp, createUser } from './helpers';

/**
 * After an admin write the API asks the site to revalidate its public pages
 * (POST REVALIDATE_URL with the shared token): what makes an edit show within seconds.
 */
describe('revalidating the public site after admin edits (e2e)', () => {
  let app: NestExpressApplication;
  let prisma: PrismaService;
  let site: Server;
  const calls: { method?: string; url?: string; headers: IncomingHttpHeaders }[] = [];
  const token = 'e2e-revalidate-token-0123456789-abcdefghij';
  const saved = { url: process.env.REVALIDATE_URL, token: process.env.REVALIDATE_TOKEN };
  const http = () => request(app.getHttpServer());

  beforeAll(async () => {
    // Stands in for the site (the Worker on Cloudflare, the web app locally).
    site = createServer((req, res) => {
      calls.push({ method: req.method, url: req.url, headers: req.headers });
      res.writeHead(200, { 'content-type': 'application/json' }).end('{"web":{"main":"200"}}');
    });
    await new Promise<void>((r) => site.listen(0, '127.0.0.1', r));
    process.env.REVALIDATE_URL = `http://127.0.0.1:${(site.address() as AddressInfo).port}/_internal/revalidate`;
    process.env.REVALIDATE_TOKEN = token;
    ({ app, prisma } = await createTestApp());
  });
  afterAll(async () => {
    await app.close();
    await new Promise((r) => site.close(r));
    for (const [k, v] of [['REVALIDATE_URL', saved.url], ['REVALIDATE_TOKEN', saved.token]] as const) {
      if (v === undefined) delete process.env[k];
      else process.env[k] = v;
    }
  });

  it('an admin edit asks the site to revalidate, with the token', async () => {
    const admin = await createUser(app, prisma, { role: 'ADMIN', prefix: 'rv-admin' });
    const before = calls.length;
    await http().put('/api/admin/settings').set('Cookie', admin.cookie).send({ supportEmail: `rv.${Date.now()}@example.com` }).expect(200);
    await app.get(PublicRevalidator).settle();
    // The call, and its follow-up 5 s later.
    expect(calls.length).toBe(before + 2);
    const call = calls.at(-1)!;
    expect(call.method).toBe('POST');
    expect(call.url).toBe('/_internal/revalidate');
    expect(call.headers['x-revalidate-token']).toBe(token);
  });

  it('a failed admin write, a student write and a read do not', async () => {
    const admin = await createUser(app, prisma, { role: 'ADMIN', prefix: 'rv-admin2' });
    const student = await createUser(app, prisma, { prefix: 'rv-student' });
    const revalidator = app.get(PublicRevalidator);
    await revalidator.settle();
    const before = calls.length;
    await http().put('/api/admin/settings').set('Cookie', admin.cookie).send({ supportEmail: 'not-an-email' }).expect(400);
    await http().put('/api/admin/settings').set('Cookie', student.cookie).send({ supportEmail: 'x@example.com' }).expect(403);
    await http().get('/api/courses').expect(200);
    await revalidator.settle();
    expect(calls.length).toBe(before);
  });
});
