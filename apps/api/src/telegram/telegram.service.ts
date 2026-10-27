import { createHmac } from 'node:crypto';
import { BadRequestException, Inject, Injectable, Logger, NotFoundException, ServiceUnavailableException } from '@nestjs/common';
import {
  normalizeTelegramUsername,
  TELEGRAM_ALLOWED_UPDATES,
  TELEGRAM_CONNECT_PATH,
  telegramInviteName,
  type AdminCourseTelegramDto,
  type LearnTelegramDto,
  type Locale,
  type TelegramLinkDto,
  type TelegramStatusDto,
} from '@academy/shared';
import { Prisma } from '@prisma/client';
import { AuditService } from '../audit/audit.service';
import type { AuthUser } from '../common/decorators';
import { ENV } from '../config/config.module';
import type { Env } from '../config/env';
import { PrismaService } from '../prisma/prisma.service';
import { signLinkToken, verifyLinkToken } from './link-token';
import { TelegramApi, TelegramError } from './telegram-api';
import { botTexts } from './texts';
import { parseUpdate, type TelegramUpdate } from './updates';

/** Join requests nobody connected or enrolled for are forgotten after this long (Telegram keeps the request itself). */
export const JOIN_REQUEST_KEEP_DAYS = 30;

/** Telegram's answers when a join request no longer exists (handled in Telegram, or withdrawn). */
const GONE = /HIDE_REQUESTER_MISSING|USER_ALREADY_PARTICIPANT|REQUEST_NOT_FOUND|user not found/i;

type Actor = Pick<AuthUser, 'id'>;
type Variant<K extends TelegramUpdate['kind']> = Extract<TelegramUpdate, { kind: K }>;

/**
 * Telegram course groups. Students connect their Telegram account with a signed deep link to the
 * bot; a course has a group and a join-request link the bot made; the bot approves requests from
 * connected accounts enrolled in a course using that group, and keeps the others waiting (never
 * declined). The bot never removes anyone from a group: that stays a manual decision in Telegram.
 */
@Injectable()
export class TelegramService {
  private readonly logger = new Logger(TelegramService.name);
  private readonly key: Buffer;

  constructor(
    private readonly prisma: PrismaService,
    private readonly api: TelegramApi,
    private readonly audit: AuditService,
    @Inject(ENV) private readonly env: Env,
  ) {
    this.key = createHmac('sha256', env.JWT_ACCESS_SECRET).update('telegram-link-v1').digest();
  }

  private connectUrl(locale: Locale): string {
    return `${this.env.WEB_URL}/${locale}${TELEGRAM_CONNECT_PATH}`;
  }

  private connectUrls() {
    return { en: this.connectUrl('en'), ar: this.connectUrl('ar') };
  }

  private requireEnabled(): void {
    if (!this.api.isEnabled()) throw new NotFoundException('Telegram is not configured');
  }

  // ------------------------------------------------------------------ students

  async status(userId: string): Promise<TelegramStatusDto> {
    if (!this.api.isEnabled()) return { enabled: false, botUsername: null, linked: false, linkedAt: null };
    const [profile, botUsername] = await Promise.all([
      this.prisma.profile.findUnique({ where: { userId }, select: { telegramUserId: true, telegramLinkedAt: true } }),
      this.api.botUsername(),
    ]);
    return {
      enabled: true,
      botUsername,
      linked: Boolean(profile?.telegramUserId),
      linkedAt: profile?.telegramUserId ? (profile.telegramLinkedAt?.toISOString() ?? null) : null,
    };
  }

  /** The deep link that connects this account: valid for 15 minutes, once. */
  async linkUrl(userId: string, now = Date.now()): Promise<TelegramLinkDto> {
    this.requireEnabled();
    const bot = await this.api.botUsername();
    if (!bot) throw new ServiceUnavailableException('Telegram is unavailable right now; try again in a minute');
    const { token, expiresAt } = signLinkToken(this.key, userId, now);
    return { url: `https://t.me/${bot}?start=${token}`, expiresAt: expiresAt.toISOString() };
  }

  /** Disconnects the Telegram account. Groups it already joined keep it: removing people stays manual. */
  async unlink(userId: string): Promise<TelegramStatusDto> {
    this.requireEnabled();
    const profile = await this.prisma.profile.findUnique({ where: { userId }, select: { telegramUserId: true } });
    if (profile?.telegramUserId) {
      await this.prisma.$transaction([
        this.prisma.telegramJoinRequest.deleteMany({ where: { telegramUserId: profile.telegramUserId } }),
        this.prisma.profile.update({ where: { userId }, data: { telegramUserId: null, telegramLinkedAt: null } }),
      ]);
      await this.audit.log({ actorId: userId, action: 'telegram.unlinked', entityType: 'User', entityId: userId });
    }
    return this.status(userId);
  }

  /** The learn page's block: the course's join link, for its enrolled students. */
  async learn(user: AuthUser, slug: string): Promise<LearnTelegramDto> {
    if (!this.api.isEnabled()) return { enabled: false, hasGroup: false, linked: false, inviteLink: null };
    const [course, profile] = await Promise.all([
      this.prisma.course.findUnique({
        where: { slug },
        select: { telegramChatId: true, telegramInviteLink: true, enrollments: { where: { userId: user.id }, select: { id: true } } },
      }),
      this.prisma.profile.findUnique({ where: { userId: user.id }, select: { telegramUserId: true } }),
    ]);
    const hasGroup = Boolean(course?.telegramChatId && course.telegramInviteLink && course.enrollments.length);
    return { enabled: true, hasGroup, linked: Boolean(profile?.telegramUserId), inviteLink: hasGroup ? course!.telegramInviteLink : null };
  }

  // ------------------------------------------------------------------ admins

  async courseGroup(courseId: string): Promise<AdminCourseTelegramDto> {
    const course = await this.prisma.course.findUnique({ where: { id: courseId }, select: { telegramChatId: true, telegramInviteLink: true } });
    if (!course) throw new NotFoundException('Course not found');
    if (!this.api.isEnabled()) return { enabled: false, botUsername: null, chat: null, inviteLink: null, chats: [] };
    const [chats, current, botUsername] = await Promise.all([
      this.prisma.telegramChat.findMany({ where: { botIsAdmin: true, canInvite: true }, orderBy: { title: 'asc' } }),
      course.telegramChatId ? this.prisma.telegramChat.findUnique({ where: { id: course.telegramChatId } }) : null,
      this.api.botUsername(),
    ]);
    return {
      enabled: true,
      botUsername,
      chat: course.telegramChatId ? { id: course.telegramChatId.toString(), title: current?.title ?? '' } : null,
      inviteLink: course.telegramInviteLink,
      chats: chats.map((c) => ({ id: c.id.toString(), title: c.title })),
    };
  }

  /**
   * Picks the course's group (a new join-request link named after the slug; the old link is
   * revoked) or clears it (null). Clearing never removes anyone from the group.
   */
  async setCourseGroup(courseId: string, chatIdText: string | null, actor: Actor): Promise<AdminCourseTelegramDto> {
    this.requireEnabled();
    const course = await this.prisma.course.findUnique({ where: { id: courseId }, select: { slug: true, telegramChatId: true, telegramInviteLink: true } });
    if (!course) throw new NotFoundException('Course not found');
    const chatId = chatIdText === null ? null : BigInt(chatIdText);
    if (chatId !== null && chatId === course.telegramChatId && course.telegramInviteLink) return this.courseGroup(courseId);

    let link: string | null = null;
    if (chatId !== null) {
      const chat = await this.prisma.telegramChat.findUnique({ where: { id: chatId } });
      if (!chat?.botIsAdmin || !chat.canInvite) {
        throw new BadRequestException({ code: 'TELEGRAM_CHAT_NOT_READY', message: 'Pick a group where the bot is an admin that can invite users' });
      }
      try {
        link = await this.api.createJoinRequestLink(chatId, telegramInviteName(course.slug));
      } catch (err) {
        this.logger.warn(`createChatInviteLink failed: ${(err as TelegramError).description ?? (err as Error).name}`);
        throw new BadRequestException({ code: 'TELEGRAM_LINK_FAILED', message: 'The bot could not create an invite link in that group: make it an admin with "Invite users", then try again' });
      }
    }
    // The old link stops working, so nobody joins the old group through this course any more.
    if (course.telegramChatId !== null && course.telegramInviteLink) {
      await this.api.revokeInviteLink(course.telegramChatId, course.telegramInviteLink).catch((err: unknown) => {
        this.logger.warn(`revokeChatInviteLink failed: ${(err as TelegramError).description ?? (err as Error).name}`);
      });
    }
    await this.prisma.course.update({ where: { id: courseId }, data: { telegramChatId: chatId, telegramInviteLink: link } });
    await this.audit.log({
      actorId: actor.id,
      action: chatId === null ? 'course.telegram_group_cleared' : 'course.telegram_group_set',
      entityType: 'Course',
      entityId: courseId,
      metadata: chatId === null ? {} : { chatId: chatId.toString() },
    });
    return this.courseGroup(courseId);
  }

  // ------------------------------------------------------------------ the webhook

  /** Handles one update. Never throws: a failure is logged and Telegram still gets its 200. */
  async handle(raw: unknown, now = new Date()): Promise<void> {
    const update = parseUpdate(raw);
    try {
      switch (update.kind) {
        case 'botMember':
          return await this.onBotMember(update);
        case 'start':
          return await this.onStart(update, now);
        case 'private':
          return await this.reply(update.chatId, botTexts.help(this.connectUrls()));
        case 'joinRequest':
          return await this.onJoinRequest(update);
        default:
          return;
      }
    } catch (err) {
      this.logger.error(`Telegram ${update.kind} update failed: ${(err as TelegramError).description ?? (err as Error).name}`);
    }
  }

  private async reply(chatId: number | bigint, text: string): Promise<void> {
    // Someone who blocked the bot can't be messaged; that never fails the update.
    await this.api.sendMessage(chatId, text).catch((err: unknown) => {
      this.logger.warn(`sendMessage failed: ${(err as TelegramError).description ?? (err as Error).name}`);
    });
  }

  private async onBotMember(u: Variant<'botMember'>): Promise<void> {
    const data = { title: u.chat.title.slice(0, 255), botIsAdmin: u.isAdmin, canInvite: u.canInvite };
    await this.prisma.telegramChat.upsert({ where: { id: BigInt(u.chat.id) }, update: data, create: { id: BigInt(u.chat.id), ...data } });
  }

  private async onStart(u: Variant<'start'>, now: Date): Promise<void> {
    if (!u.payload) return this.reply(u.chatId, botTexts.help(this.connectUrls()));
    const token = verifyLinkToken(this.key, u.payload, now.getTime());
    const user = token
      ? await this.prisma.user.findFirst({
          where: { id: token.userId, deletedAt: null },
          select: { id: true, locale: true, profile: { select: { telegramUserId: true, telegramLinkedAt: true, telegramUsername: true } } },
        })
      : null;
    if (!token || !user) return this.reply(u.chatId, botTexts.expired(this.connectUrls()));
    const telegramUserId = BigInt(u.from.id);

    if (user.profile?.telegramUserId === telegramUserId) {
      const approved = await this.approveWaiting(user.id, telegramUserId);
      return this.reply(u.chatId, approved ? botTexts.linked(user.locale, approved) : botTexts.alreadyLinked(user.locale));
    }
    // One academy account per Telegram account: connecting a second one is refused, never moved.
    const owner = await this.prisma.profile.findUnique({ where: { telegramUserId }, select: { userId: true } });
    if (owner) return this.reply(u.chatId, botTexts.takenByOther(user.locale));
    // Single use: a token made before the account's last connection is spent.
    if (user.profile?.telegramLinkedAt && user.profile.telegramLinkedAt >= token.issuedAt) return this.reply(u.chatId, botTexts.expired(this.connectUrls()));

    const username = user.profile?.telegramUsername ? null : u.from.username && normalizeTelegramUsername(u.from.username);
    const data = { telegramUserId, telegramLinkedAt: now, ...(username ? { telegramUsername: username } : {}) };
    try {
      await this.prisma.profile.upsert({ where: { userId: user.id }, update: data, create: { userId: user.id, ...data } });
    } catch (err) {
      // Another account took this Telegram account a moment ago.
      if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') return this.reply(u.chatId, botTexts.takenByOther(user.locale));
      throw err;
    }
    await this.audit.log({ actorId: user.id, action: 'telegram.linked', entityType: 'User', entityId: user.id });
    const approved = await this.approveWaiting(user.id, telegramUserId);
    await this.reply(u.chatId, botTexts.linked(user.locale, approved));
  }

  private async onJoinRequest(u: Variant<'joinRequest'>): Promise<void> {
    const chatId = BigInt(u.chatId);
    const courses = await this.prisma.course.findMany({ where: { telegramChatId: chatId }, select: { id: true, titleEn: true, titleAr: true }, orderBy: { createdAt: 'desc' } });
    // Not a course group: the group's own admins decide.
    if (!courses.length) return;
    const telegramUserId = BigInt(u.from.id);
    const profile = await this.prisma.profile.findUnique({
      where: { telegramUserId },
      select: { userId: true, user: { select: { locale: true, deletedAt: true } } },
    });
    if (profile && !profile.user.deletedAt && (await this.enrolledIn(profile.userId, chatId))) {
      await this.approve(chatId, telegramUserId);
      return;
    }
    // Kept until the person connects or enrols (or for 30 days); never declined.
    await this.prisma.telegramJoinRequest.upsert({
      where: { chatId_telegramUserId: { chatId, telegramUserId } },
      update: {},
      create: { chatId, telegramUserId },
    });
    const course = courses[0]!;
    const text = profile && !profile.user.deletedAt ? botTexts.joinNotEnrolled(profile.user.locale, course) : botTexts.joinUnlinked(course, this.connectUrls());
    await this.reply(u.userChatId, text);
  }

  private async enrolledIn(userId: string, chatId: bigint): Promise<boolean> {
    return (await this.prisma.course.count({ where: { telegramChatId: chatId, enrollments: { some: { userId } } } })) > 0;
  }

  /** Approves one request; true when it is done with (approved, or no longer pending in Telegram). */
  private async approve(chatId: bigint, telegramUserId: bigint): Promise<boolean> {
    try {
      await this.api.approveJoinRequest(chatId, telegramUserId);
      return true;
    } catch (err) {
      const gone = err instanceof TelegramError && GONE.test(err.description);
      if (!gone) this.logger.warn(`approveChatJoinRequest failed: ${(err as TelegramError).description ?? (err as Error).name}`);
      return gone;
    }
  }

  /** Approves this person's waiting requests for groups of courses they are enrolled in; returns how many. */
  private async approveWaiting(userId: string, telegramUserId: bigint): Promise<number> {
    const waiting = await this.prisma.telegramJoinRequest.findMany({ where: { telegramUserId } });
    let approved = 0;
    for (const r of waiting) {
      if (!(await this.enrolledIn(userId, r.chatId))) continue;
      const done = await this.approve(r.chatId, telegramUserId);
      if (done) {
        approved++;
        await this.prisma.telegramJoinRequest.deleteMany({ where: { chatId: r.chatId, telegramUserId } });
      }
    }
    return approved;
  }

  /**
   * The hourly job: lets in people who asked before they were enrolled (or connected), and
   * forgets requests older than 30 days. Only waiting rows are read, so it costs nothing when idle.
   */
  async sweep(now = new Date()): Promise<number> {
    if (!this.api.isEnabled()) return 0;
    await this.prisma.telegramJoinRequest.deleteMany({ where: { createdAt: { lt: new Date(now.getTime() - JOIN_REQUEST_KEEP_DAYS * 86_400_000) } } });
    const waiting = await this.prisma.telegramJoinRequest.findMany({ orderBy: { createdAt: 'asc' }, take: 500, select: { telegramUserId: true } });
    if (!waiting.length) return 0;
    const profiles = await this.prisma.profile.findMany({
      where: { telegramUserId: { in: [...new Set(waiting.map((w) => w.telegramUserId))] }, user: { deletedAt: null } },
      select: { userId: true, telegramUserId: true },
    });
    let approved = 0;
    for (const p of profiles) approved += await this.approveWaiting(p.userId, p.telegramUserId!);
    return approved;
  }

  /** On start: points Telegram at our webhook. Logs and carries on when it can't. */
  async registerWebhook(): Promise<boolean> {
    if (!this.api.isEnabled()) {
      if (this.env.TELEGRAM_BOT_TOKEN || this.env.TELEGRAM_WEBHOOK_SECRET) {
        this.logger.warn('Telegram groups are off: set both TELEGRAM_BOT_TOKEN and TELEGRAM_WEBHOOK_SECRET');
      }
      return false;
    }
    // Telegram only calls https URLs (locally, use a tunnel and set WEB_URL to it).
    if (!this.env.WEB_URL.startsWith('https://')) {
      this.logger.warn('Telegram webhook not registered: WEB_URL is not https');
      return false;
    }
    try {
      await this.api.setWebhook(`${this.env.WEB_URL}/api/telegram/webhook`, TELEGRAM_ALLOWED_UPDATES);
      return true;
    } catch (err) {
      this.logger.warn(`setWebhook failed: ${(err as TelegramError).description ?? (err as Error).name}`);
      return false;
    }
  }
}
