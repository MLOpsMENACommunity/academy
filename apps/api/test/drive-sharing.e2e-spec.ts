import { Test } from '@nestjs/testing';
import type { NestExpressApplication } from '@nestjs/platform-express';
import request from 'supertest';
import { AppModule } from '../src/app.module';
import { DRIVE_API, DriveShareFailed, type DriveApi } from '../src/drive/drive-api';
import { DriveSharingService } from '../src/drive/drive-sharing.service';
import { PrismaService } from '../src/prisma/prisma.service';
import { configureApp } from '../src/setup';
import { ProfileService } from '../src/users/profile.service';
import { createCourse, createUser } from './helpers';

const ACCOUNT = 'academy-drive@project.iam.gserviceaccount.com';
const FOLDER = 'FOLDER_abc123456789';

/** Google Drive as the academy sees it: who can read each folder. */
class FakeDrive implements DriveApi {
  readers = new Map<string, Set<string>>();
  folders = new Map<string, { name: string; canShare: boolean }>([[FOLDER, { name: 'Recordings', canShare: true }]]);
  configured = true;
  /** Addresses Google refuses (not Google accounts). */
  refuse = new Set<string>();

  account() {
    return this.configured ? ACCOUNT : null;
  }
  async folder(id: string) {
    const f = this.folders.get(id);
    if (!f) throw new DriveShareFailed('no_folder_access', 'File not found');
    return f;
  }
  async share(id: string, email: string) {
    await this.folder(id);
    if (this.refuse.has(email)) throw new DriveShareFailed('not_google_account', 'Invalid sharing request');
    this.reader(id).add(email.toLowerCase());
  }
  async unshare(id: string, email: string) {
    await this.folder(id);
    return this.reader(id).delete(email.toLowerCase());
  }
  reader(id: string) {
    if (!this.readers.has(id)) this.readers.set(id, new Set());
    return this.readers.get(id)!;
  }
}

describe('automatic Drive sharing (e2e)', () => {
  let app: NestExpressApplication;
  let prisma: PrismaService;
  let sharing: DriveSharingService;
  const drive = new FakeDrive();
  const http = () => request(app.getHttpServer());

  beforeAll(async () => {
    process.env.EMAIL_PROVIDER = 'log';
    process.env.JOBS_ENABLED = 'false';
    process.env.PUBLIC_CACHE_TTL_S ??= '0';
    process.env.SIGNED_IN_CACHE_TTL_S ??= '0';
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).overrideProvider(DRIVE_API).useValue(drive).compile();
    app = moduleRef.createNestApplication<NestExpressApplication>({ logger: ['error'], bodyParser: false });
    configureApp(app);
    await app.init();
    prisma = app.get(PrismaService);
    sharing = app.get(DriveSharingService);
  });
  afterAll(() => app.close());
  beforeEach(() => {
    drive.configured = true;
    drive.refuse.clear();
  });

  async function driveCourse(folderUrl: string | null = `https://drive.google.com/drive/folders/${FOLDER}`) {
    const c = await createCourse(prisma, { type: 'PAID', price: 100 });
    await prisma.course.update({ where: { id: c.id }, data: { status: 'OPEN', recordingsPlatform: 'GOOGLE_DRIVE', driveFolderUrl: folderUrl } });
    return c;
  }
  async function enrol(courseId: string) {
    const s = await createUser(app, prisma);
    const e = await prisma.enrollment.create({ data: { userId: s.id, courseId } });
    return { ...s, google: `g.${s.email}`.toLowerCase(), enrollmentId: e.id };
  }

  it('shares the folder with enrolled students on the scheduled run, once, and audits it', async () => {
    const c = await driveCourse();
    const a = await enrol(c.id);
    const b = await enrol(c.id);
    // Free courses and courses without a folder are left alone.
    const free = await createCourse(prisma);
    const other = await enrol(free.id);

    expect(await sharing.runAll()).toBeGreaterThanOrEqual(2);
    expect([...drive.reader(FOLDER)]).toEqual(expect.arrayContaining([a.google, b.google]));
    expect([...drive.reader(FOLDER)]).not.toContain(other.google);
    const rows = await prisma.enrollment.findMany({ where: { courseId: c.id } });
    expect(rows.every((r) => r.driveAccessGranted && r.driveAccessGrantedAt && !r.driveShareError)).toBe(true);
    expect(await prisma.auditLog.count({ where: { entityId: a.enrollmentId, action: 'enrollment.drive_access_granted', actorId: null } })).toBe(1);

    // Nothing left to do: a second run changes nothing.
    expect((await sharing.syncCourse(c.id)).changed).toBe(0);
  });

  it('removes the old address when a student changes their Google account, without alerting admins', async () => {
    const c = await driveCourse();
    const s = await enrol(c.id);
    await sharing.syncCourse(c.id);
    const admin = await createUser(app, prisma, { role: 'ADMIN', prefix: 'drive-admin' });

    await prisma.profile.update({ where: { userId: s.id }, data: { googleEmail: 'new.account@gmail.com' } });
    await app.get(ProfileService).alertDriveAccess(s.id, 'changed', s.google);
    expect(await prisma.notification.count({ where: { userId: admin.id, type: 'admin.drive_access_changed' } })).toBe(0);

    await sharing.syncCourse(c.id);
    expect(drive.reader(FOLDER).has(s.google)).toBe(false);
    expect(drive.reader(FOLDER).has('new.account@gmail.com')).toBe(true);
    const e = await prisma.enrollment.findUniqueOrThrow({ where: { id: s.enrollmentId } });
    expect(e).toMatchObject({ driveAccessGranted: true, driveRevokeEmail: null });
  });

  it('still alerts admins about a changed Google account when sharing is manual', async () => {
    const c = await driveCourse();
    const s = await enrol(c.id);
    const admin = await createUser(app, prisma, { role: 'ADMIN', prefix: 'drive-manual' });
    drive.configured = false;
    await app.get(ProfileService).alertDriveAccess(s.id, 'changed', s.google);
    expect(await prisma.notification.count({ where: { userId: admin.id, type: 'admin.drive_access_changed' } })).toBe(1);
    expect(await sharing.runAll()).toBe(0);
  });

  it('records why sharing failed, alerts admins once, and retries with Share now', async () => {
    const c = await driveCourse();
    const s = await enrol(c.id);
    const admin = await createUser(app, prisma, { role: 'ADMIN', adminPermissions: ['ADMISSIONS'], prefix: 'drive-adm' });
    drive.refuse.add(s.google);

    expect(await sharing.syncCourse(c.id)).toEqual({ changed: 0, failed: 1 });
    expect(await sharing.syncCourse(c.id)).toEqual({ changed: 0, failed: 0 }); // not tried again within a day
    expect(await prisma.notification.count({ where: { userId: admin.id, type: 'admin.drive_sharing_failed' } })).toBe(1);
    const list = await http().get(`/api/admin/courses/${c.id}/enrollments`).set('Cookie', admin.cookie).expect(200);
    expect(list.body[0]).toMatchObject({ driveAccessGranted: false, driveShareError: 'not_google_account' });

    drive.refuse.clear();
    const run = await http().post(`/api/admin/courses/${c.id}/drive-sharing/run`).set('Cookie', admin.cookie).expect(200);
    expect(run.body).toMatchObject({ changed: 1, failed: 0, status: { state: 'ready', account: ACCOUNT, folderName: 'Recordings' } });
    expect(await prisma.auditLog.count({ where: { entityId: s.enrollmentId, action: 'enrollment.drive_access_granted', actorId: admin.id } })).toBe(1);
  });

  it('tells admins what to fix in the folder, and only to ADMISSIONS and ACADEMIC', async () => {
    const shared = await driveCourse();
    const unshared = await driveCourse('https://drive.google.com/drive/folders/NOT_SHARED_123456');
    const noFolder = await driveCourse(null);
    const admin = await createUser(app, prisma, { role: 'ADMIN', adminPermissions: ['ACADEMIC'], prefix: 'drive-acad' });
    const finance = await createUser(app, prisma, { role: 'ADMIN', adminPermissions: ['FINANCE'], prefix: 'drive-fin' });
    const status = (id: string) => http().get(`/api/admin/courses/${id}/drive-sharing`).set('Cookie', admin.cookie).expect(200);

    expect((await status(shared.id)).body).toEqual({ state: 'ready', account: ACCOUNT, folderName: 'Recordings' });
    expect((await status(unshared.id)).body).toEqual({ state: 'no_access', account: ACCOUNT, folderName: null });
    expect((await status(noFolder.id)).body.state).toBe('no_folder');
    drive.configured = false;
    expect((await status(shared.id)).body.state).toBe('off');
    await http().get(`/api/admin/courses/${shared.id}/drive-sharing`).set('Cookie', finance.cookie).expect(403);
    await http().post(`/api/admin/courses/${shared.id}/drive-sharing/run`).set('Cookie', finance.cookie).expect(403);
  });

  it('removes a deleted account from the folder', async () => {
    const c = await driveCourse();
    const s = await enrol(c.id);
    await sharing.syncCourse(c.id);
    await prisma.user.update({ where: { id: s.id }, data: { deletedAt: new Date() } });
    await app.get(ProfileService).alertDriveAccess(s.id, 'deleted', s.google);
    await sharing.syncCourse(c.id);
    expect(drive.reader(FOLDER).has(s.google)).toBe(false);
    expect((await prisma.enrollment.findUniqueOrThrow({ where: { id: s.enrollmentId } })).driveRevokeEmail).toBeNull();
  });
});
