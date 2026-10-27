import type { NestExpressApplication } from '@nestjs/platform-express';
import request from 'supertest';
import { AccountService } from '../src/users/account.service';
import { ENV } from '../src/config/config.module';
import type { Env } from '../src/config/env';
import { PrismaService } from '../src/prisma/prisma.service';
import { TELEGRAM_FETCH } from '../src/telegram/telegram-api';
import { TelegramService } from '../src/telegram/telegram.service';
import { createCourse, createTestApp, createUser } from './helpers';

const TOKEN = `123456789:${'A'.repeat(35)}`;
const SECRET = 's'.repeat(40);
const BOT = 'academy_test_bot';

/** Every Bot API call the app makes, answered like Telegram would. */
interface Call {
  method: string;
  params: Record<string, unknown>;
}

describe('Telegram course groups (e2e)', () => {
  let app: NestExpressApplication;
  let prisma: PrismaService;
  let calls: Call[] = [];
  let links = 0;
  const http = () => request(app.getHttpServer());
  const called = (method: string) => calls.filter((c) => c.method === method);

  const fakeFetch = async (input: string | URL | Request, init?: RequestInit): Promise<Response> => {
    const url = String(input);
    expect(url.startsWith(`https://api.telegram.org/bot${TOKEN}/`)).toBe(true);
    const method = url.slice(url.lastIndexOf('/') + 1);
    const params = JSON.parse(String(init?.body ?? '{}')) as Record<string, unknown>;
    calls.push({ method, params });
    const result = method === 'getMe' ? { id: 1, is_bot: true, username: BOT } : method === 'createChatInviteLink' ? { invite_link: `https://t.me/+link${++links}` } : true;
    return new Response(JSON.stringify({ ok: true, result }), { headers: { 'content-type': 'application/json' } });
  };

  beforeAll(async () => {
    process.env.TELEGRAM_BOT_TOKEN = TOKEN;
    process.env.TELEGRAM_WEBHOOK_SECRET = SECRET;
    ({ app, prisma } = await createTestApp((b) => b.overrideProvider(TELEGRAM_FETCH).useValue(fakeFetch)));
  });
  afterAll(async () => {
    delete process.env.TELEGRAM_BOT_TOKEN;
    delete process.env.TELEGRAM_WEBHOOK_SECRET;
    await app.close();
  });
  beforeEach(() => {
    calls = [];
  });

  /** A fresh Telegram id per use (the database outlives one run locally). */
  let seq = 0;
  const tgId = () => (Date.now() % 1_000_000_000) * 100 + (seq++ % 100) + 1_000;
  const update = (body: unknown) => http().post('/api/telegram/webhook').set('X-Telegram-Bot-Api-Secret-Token', SECRET).send(body as object);
  const from = (id: number, username = 'tg_user') => ({ id, is_bot: false, first_name: 'T', username, language_code: 'en' });
  const start = (id: number, payload: string, username?: string) =>
    update({ update_id: 1, message: { message_id: 1, date: 1, chat: { id, type: 'private' }, from: from(id, username), text: `/start ${payload}` } });
  const joinRequest = (chatId: number, id: number) =>
    update({ update_id: 2, chat_join_request: { chat: { id: chatId, type: 'supergroup', title: 'G' }, from: from(id), user_chat_id: id, date: 1 } });
  const botAdded = (chatId: number, title: string, canInvite = true) =>
    update({
      update_id: 3,
      my_chat_member: {
        chat: { id: chatId, type: 'supergroup', title },
        from: from(5),
        date: 1,
        old_chat_member: { status: 'left', user: { id: 1, is_bot: true } },
        new_chat_member: { status: 'administrator', can_invite_users: canInvite, user: { id: 1, is_bot: true } },
      },
    });
  /** The token in the "Connect Telegram" link for this cookie. */
  const linkToken = async (cookie: string): Promise<string> => {
    const res = await http().post('/api/me/telegram/link').set('Cookie', cookie).expect(200);
    expect(res.body.url).toMatch(new RegExp(`^https://t\\.me/${BOT}\\?start=[\\w-]{1,64}$`));
    return new URL(res.body.url).searchParams.get('start')!;
  };
  /** A course whose group is `chatId`, with the given students enrolled. */
  const courseWithGroup = async (chatId: number, enrolled: string[] = []) => {
    const c = await createCourse(prisma);
    await prisma.course.update({ where: { id: c.id }, data: { telegramChatId: BigInt(chatId), telegramInviteLink: `https://t.me/+fixed${chatId}` } });
    for (const userId of enrolled) await prisma.enrollment.create({ data: { userId, courseId: c.id } });
    return c;
  };

  it('refuses webhook calls without the secret, and answers 404 when the bot is not configured', async () => {
    await http().post('/api/telegram/webhook').send({ update_id: 1 }).expect(401);
    await http().post('/api/telegram/webhook').set('X-Telegram-Bot-Api-Secret-Token', 'x'.repeat(40)).send({ update_id: 1 }).expect(401);
    await update({ update_id: 1, something_new: {} }).expect(200);
    const env = app.get<Env>(ENV);
    env.TELEGRAM_WEBHOOK_SECRET = undefined;
    try {
      await update({ update_id: 1 }).expect(404);
      expect((await createUser(app, prisma).then((u) => http().get('/api/me/telegram').set('Cookie', u.cookie))).body).toMatchObject({ enabled: false });
    } finally {
      env.TELEGRAM_WEBHOOK_SECRET = SECRET;
    }
    expect(calls).toEqual([]);
  });

  it('records the groups the bot is made an admin of', async () => {
    const chatId = -tgId();
    await botAdded(chatId, 'MLOps 101 group').expect(200);
    expect(await prisma.telegramChat.findUnique({ where: { id: BigInt(chatId) } })).toMatchObject({ title: 'MLOps 101 group', botIsAdmin: true, canInvite: true });
    await update({ my_chat_member: { chat: { id: chatId, type: 'supergroup', title: 'MLOps 101 group' }, new_chat_member: { status: 'left' } } }).expect(200);
    expect(await prisma.telegramChat.findUnique({ where: { id: BigInt(chatId) } })).toMatchObject({ botIsAdmin: false, canInvite: false });
  });

  it('connects an account with /start, once, fills an empty username, and refuses a Telegram account taken by another', async () => {
    const student = await createUser(app, prisma);
    await prisma.profile.update({ where: { userId: student.id }, data: { telegramUsername: null } });
    expect((await http().get('/api/me/telegram').set('Cookie', student.cookie).expect(200)).body).toEqual({ enabled: true, botUsername: BOT, linked: false, linkedAt: null });

    const id = tgId();
    const token = await linkToken(student.cookie);
    await start(id, token, 'Layla_ML').expect(200);
    const profile = await prisma.profile.findUnique({ where: { userId: student.id } });
    expect(profile).toMatchObject({ telegramUserId: BigInt(id), telegramUsername: 'Layla_ML' });
    expect(called('sendMessage')).toEqual([expect.objectContaining({ params: expect.objectContaining({ chat_id: id, text: expect.stringContaining('now connected') }) })]);
    expect((await http().get('/api/me/telegram').set('Cookie', student.cookie)).body).toMatchObject({ linked: true });

    // The same link again from another Telegram account: spent.
    calls = [];
    const other = tgId();
    await start(other, token).expect(200);
    expect(called('sendMessage')[0]!.params.text).toContain('expired or was already used');
    expect((await prisma.profile.findUnique({ where: { userId: student.id } }))!.telegramUserId).toBe(BigInt(id));

    // A second academy account can't take this Telegram account.
    calls = [];
    const second = await createUser(app, prisma);
    await start(id, await linkToken(second.cookie)).expect(200);
    expect(called('sendMessage')[0]!.params.text).toContain('connected to another academy account');
    expect((await prisma.profile.findUnique({ where: { userId: second.id } }))!.telegramUserId).toBeNull();

    // A forged token, and /start alone.
    calls = [];
    await start(other, `${student.id}_zzzzzz_${'A'.repeat(22)}`).expect(200);
    await update({ message: { chat: { id: other, type: 'private' }, from: from(other), text: '/start' } }).expect(200);
    expect(called('sendMessage').map((c) => c.params.text)).toEqual([expect.stringContaining('expired'), expect.stringContaining('Connect Telegram')]);
    expect(await prisma.profile.count({ where: { telegramUserId: BigInt(other) } })).toBe(0);

    // Disconnect, and the account can connect again.
    expect((await http().delete('/api/me/telegram').set('Cookie', student.cookie).expect(200)).body).toMatchObject({ linked: false });
    expect(await prisma.auditLog.count({ where: { entityId: student.id, action: { in: ['telegram.linked', 'telegram.unlinked'] } } })).toBe(2);
  });

  it('approves join requests from connected, enrolled students at once', async () => {
    const chatId = -tgId();
    const student = await createUser(app, prisma);
    const id = tgId();
    await start(id, await linkToken(student.cookie)).expect(200);
    const c = await courseWithGroup(chatId, [student.id]);
    calls = [];
    await joinRequest(chatId, id).expect(200);
    expect(called('approveChatJoinRequest')).toEqual([{ method: 'approveChatJoinRequest', params: { chat_id: chatId, user_id: id } }]);
    expect(await prisma.telegramJoinRequest.count({ where: { chatId: BigInt(chatId) } })).toBe(0);

    // The learn page shows the link to enrolled students only.
    expect((await http().get(`/api/learn/${c.slug}/telegram`).set('Cookie', student.cookie).expect(200)).body).toEqual({
      enabled: true,
      hasGroup: true,
      linked: true,
      inviteLink: `https://t.me/+fixed${chatId}`,
    });
    const outsider = await createUser(app, prisma);
    expect((await http().get(`/api/learn/${c.slug}/telegram`).set('Cookie', outsider.cookie).expect(200)).body).toMatchObject({ hasGroup: false, inviteLink: null });
  });

  it('keeps a request from an unconnected account waiting, tells them how to connect, and approves it after /start', async () => {
    const chatId = -tgId();
    const student = await createUser(app, prisma);
    await courseWithGroup(chatId, [student.id]);
    const id = tgId();
    await joinRequest(chatId, id).expect(200);
    expect(called('approveChatJoinRequest')).toEqual([]);
    expect(called('declineChatJoinRequest')).toEqual([]);
    expect(await prisma.telegramJoinRequest.count({ where: { chatId: BigInt(chatId), telegramUserId: BigInt(id) } })).toBe(1);
    const dm = called('sendMessage');
    expect(dm).toHaveLength(1);
    expect(dm[0]!.params.chat_id).toBe(id);
    expect(dm[0]!.params.text).toEqual(expect.stringContaining('/en/profile?tab=community'));
    expect(dm[0]!.params.text).toEqual(expect.stringContaining('/ar/profile?tab=community'));

    calls = [];
    await start(id, await linkToken(student.cookie)).expect(200);
    expect(called('approveChatJoinRequest')).toEqual([{ method: 'approveChatJoinRequest', params: { chat_id: chatId, user_id: id } }]);
    expect(called('sendMessage')[0]!.params.text).toContain('waiting requests to join your course groups were approved');
    expect(await prisma.telegramJoinRequest.count({ where: { telegramUserId: BigInt(id) } })).toBe(0);
  });

  it('never approves a connected account that is not enrolled, until it enrols (the hourly job)', async () => {
    const chatId = -tgId();
    const student = await createUser(app, prisma);
    const id = tgId();
    await start(id, await linkToken(student.cookie)).expect(200);
    const c = await courseWithGroup(chatId);
    calls = [];
    await joinRequest(chatId, id).expect(200);
    expect(called('approveChatJoinRequest')).toEqual([]);
    expect(called('sendMessage')[0]!.params.text).toContain('is waiting: the group is for the course');
    expect(await prisma.telegramJoinRequest.count({ where: { chatId: BigInt(chatId), telegramUserId: BigInt(id) } })).toBe(1);

    const telegram = app.get(TelegramService);
    calls = [];
    await telegram.sweep();
    expect(called('approveChatJoinRequest')).toEqual([]);
    await prisma.enrollment.create({ data: { userId: student.id, courseId: c.id } });
    await telegram.sweep();
    expect(called('approveChatJoinRequest')).toEqual([{ method: 'approveChatJoinRequest', params: { chat_id: chatId, user_id: id } }]);
    expect(await prisma.telegramJoinRequest.count({ where: { telegramUserId: BigInt(id) } })).toBe(0);
  });

  it('ignores join requests to groups that belong to no course', async () => {
    await joinRequest(-tgId(), tgId()).expect(200);
    expect(calls).toEqual([]);
  });

  it('lets ACADEMIC admins pick a group, which makes a join-request link, and change or clear it', async () => {
    const c = await createCourse(prisma);
    const academic = await createUser(app, prisma, { role: 'ADMIN', adminPermissions: ['ACADEMIC'], prefix: 'acad' });
    const finance = await createUser(app, prisma, { role: 'ADMIN', adminPermissions: ['FINANCE'], prefix: 'fin' });
    const base = `/api/admin/courses/${c.id}/telegram`;
    await http().get(base).set('Cookie', finance.cookie).expect(403);
    await http().put(base).set('Cookie', finance.cookie).send({ chatId: null }).expect(403);
    const student = await createUser(app, prisma);
    await http().get(base).set('Cookie', student.cookie).expect(403);

    const ready = -tgId();
    const notAdmin = -tgId();
    await botAdded(ready, 'Ready group').expect(200);
    await botAdded(notAdmin, 'No invite rights', false).expect(200);
    const before = (await http().get(base).set('Cookie', academic.cookie).expect(200)).body;
    expect(before).toMatchObject({ enabled: true, botUsername: BOT, chat: null, inviteLink: null });
    expect(before.chats).toContainEqual({ id: String(ready), title: 'Ready group' });
    expect(before.chats).not.toContainEqual(expect.objectContaining({ id: String(notAdmin) }));

    const bad = await http().put(base).set('Cookie', academic.cookie).send({ chatId: String(notAdmin) }).expect(400);
    expect(bad.body.code).toBe('TELEGRAM_CHAT_NOT_READY');
    await http().put(base).set('Cookie', academic.cookie).send({ chatId: 'abc' }).expect(400);

    calls = [];
    const set = (await http().put(base).set('Cookie', academic.cookie).send({ chatId: String(ready) }).expect(200)).body;
    expect(called('createChatInviteLink')).toEqual([{ method: 'createChatInviteLink', params: { chat_id: ready, name: c.slug.slice(0, 32), creates_join_request: true } }]);
    expect(set).toMatchObject({ chat: { id: String(ready), title: 'Ready group' }, inviteLink: `https://t.me/+link${links}` });
    expect(await prisma.course.findUnique({ where: { id: c.id }, select: { telegramChatId: true } })).toEqual({ telegramChatId: BigInt(ready) });
    // The admin course view still works with a BigInt on the row.
    await http().get(`/api/admin/courses/${c.id}`).set('Cookie', academic.cookie).expect(200);

    // Saving the same group again keeps the link.
    calls = [];
    await http().put(base).set('Cookie', academic.cookie).send({ chatId: String(ready) }).expect(200);
    expect(calls).toEqual([]);

    // Clearing revokes the link (and removes nobody).
    const link = set.inviteLink as string;
    calls = [];
    expect((await http().put(base).set('Cookie', academic.cookie).send({ chatId: null }).expect(200)).body).toMatchObject({ chat: null, inviteLink: null });
    expect(calls).toEqual([{ method: 'revokeChatInviteLink', params: { chat_id: ready, invite_link: link } }]);
    expect(await prisma.auditLog.count({ where: { entityId: c.id, action: { in: ['course.telegram_group_set', 'course.telegram_group_cleared'] } } })).toBe(2);
  });

  it('disconnects the Telegram account when the account is deleted, and exports the connection', async () => {
    const student = await createUser(app, prisma);
    const id = tgId();
    await start(id, await linkToken(student.cookie)).expect(200);
    const exported = (await http().get('/api/me/export').set('Cookie', student.cookie).expect(200)).body;
    expect(exported.telegram).toMatchObject({ connected: true, telegramUserId: String(id) });

    const chatId = -tgId();
    await courseWithGroup(chatId);
    await joinRequest(chatId, id).expect(200);
    expect(await prisma.telegramJoinRequest.count({ where: { telegramUserId: BigInt(id) } })).toBe(1);

    await app.get(AccountService).deleteByAdmin(student.id, student.email, (await createUser(app, prisma, { role: 'ADMIN' })).id);
    expect(await prisma.profile.findUnique({ where: { userId: student.id }, select: { telegramUserId: true, telegramLinkedAt: true } })).toEqual({ telegramUserId: null, telegramLinkedAt: null });
    expect(await prisma.telegramJoinRequest.count({ where: { telegramUserId: BigInt(id) } })).toBe(0);
  });
});
