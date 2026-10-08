import { Inject, Injectable, Logger, NotFoundException } from '@nestjs/common';
import type { CalendarFeedDto, Locale } from '@academy/shared';
import { createHmac, timingSafeEqual } from 'node:crypto';
import { sha256 } from '../common/crypto';
import { ENV } from '../config/config.module';
import type { Env } from '../config/env';
import { buildIcs, type IcsEvent } from '../learn/ics';
import { courseSessionEvent } from '../learn/session-event';
import { PrismaService } from '../prisma/prisma.service';

/** 32 bytes of HMAC-SHA256 in base64url. */
const TOKEN_RE = /^[A-Za-z0-9_-]{43}$/;
export const isFeedToken = (token: string): boolean => TOKEN_RE.test(token);
const FEED_NAME = 'MLOps MENA Academy';
/** Writing lastFetchedAt on every poll is pointless; once an hour is enough to show "last synced". */
const TOUCH_EVERY_MS = 60 * 60_000;
/**
 * How often calendar apps should poll. Apple and Outlook honour it (Google polls on
 * its own schedule). Every poll wakes the API container and the database, so this
 * stays at hours, not minutes; reminder emails cover last-minute changes.
 */
const REFRESH_INTERVAL = 'PT6H';

export interface FeedOwner {
  id: string;
  locale: Locale;
}

/**
 * Private calendar subscription feeds ("webcal" links for Google, Apple and
 * Outlook Calendar). Calendar apps poll the feed without cookies, so the URL
 * itself is the credential:
 *
 * - The token is HMAC-SHA256(server key, `${userId}:${version}`): 256 bits,
 *   unguessable, and re-derivable, so the student can see and copy their link
 *   again at any time. Resetting the link bumps `version`.
 * - Only SHA-256(token) is stored, to find the feed from a request. A database
 *   dump alone never yields working links.
 * - Every request is also checked against the HMAC under the current key, so
 *   rotating the key revokes every existing link at once.
 * - The feed never contains live (Meet/YouTube) links, recordings or
 *   materials: only titles, times and a link to the course page.
 */
@Injectable()
export class CalendarFeedService {
  private readonly logger = new Logger(CalendarFeedService.name);
  private readonly key: Buffer;

  constructor(
    private readonly prisma: PrismaService,
    @Inject(ENV) private readonly env: Env,
  ) {
    // A subkey for this one purpose: the JWT secret itself never signs feed tokens.
    // Rotating JWT_ACCESS_SECRET revokes every calendar link immediately (render()
    // checks the HMAC); students get a new link the next time they open the menu.
    this.key = createHmac('sha256', env.JWT_ACCESS_SECRET).update('academy:calendar-feed:v1').digest();
  }

  private token(userId: string, version: number): string {
    return createHmac('sha256', this.key).update(`${userId}:${version}`).digest('base64url');
  }

  /** Constant-time check that the token is the one the current key issues for this feed. */
  private matches(token: string, userId: string, version: number): boolean {
    const expected = Buffer.from(this.token(userId, version));
    const given = Buffer.from(token);
    return expected.length === given.length && timingSafeEqual(expected, given);
  }

  /** Public URL: the Worker (and the dev proxy) route `${WEB_URL}/api/*` to the API. */
  private url(token: string): string {
    return `${this.env.WEB_URL}/api/calendar/${token}.ics`;
  }

  async status(userId: string): Promise<CalendarFeedDto> {
    const feed = await this.prisma.calendarFeed.findUnique({ where: { userId } });
    if (!feed) return { exists: false, url: null, createdAt: null, lastFetchedAt: null };
    const token = this.token(userId, feed.version);
    const tokenHash = sha256(token);
    // After a server key rotation the old link is dead (render() rejects it): issue the new one.
    if (tokenHash !== feed.tokenHash) await this.prisma.calendarFeed.update({ where: { userId }, data: { tokenHash } });
    return {
      exists: true,
      url: this.url(token),
      createdAt: feed.createdAt.toISOString(),
      lastFetchedAt: feed.lastFetchedAt?.toISOString() ?? null,
    };
  }

  /** Creates the link if there is none; with `rotate`, replaces it (the old URL stops working). */
  async create(userId: string, rotate: boolean): Promise<CalendarFeedDto> {
    const existing = await this.prisma.calendarFeed.findUnique({ where: { userId } });
    if (existing && !rotate) return this.status(userId);
    const version = existing ? existing.version + 1 : 1;
    const tokenHash = sha256(this.token(userId, version));
    await this.prisma.calendarFeed.upsert({
      where: { userId },
      create: { userId, version, tokenHash },
      // Without `rotate` this only runs when a concurrent first create won the race: keep its row.
      update: rotate ? { version, tokenHash, rotatedAt: new Date(), lastFetchedAt: null } : {},
    });
    return this.status(userId);
  }

  /** The feed body for a token, or 404 for an unknown, reset or deleted-account token. */
  async render(token: string, now = new Date()): Promise<string> {
    if (!isFeedToken(token)) throw new NotFoundException('Calendar not found');
    const feed = await this.prisma.calendarFeed.findUnique({
      where: { tokenHash: sha256(token) },
      include: { user: { select: { id: true, locale: true, deletedAt: true } } },
    });
    if (!feed || feed.user.deletedAt || !this.matches(token, feed.userId, feed.version)) {
      throw new NotFoundException('Calendar not found');
    }
    if (!feed.lastFetchedAt || now.getTime() - feed.lastFetchedAt.getTime() > TOUCH_EVERY_MS) {
      await this.prisma.calendarFeed
        .update({ where: { id: feed.id }, data: { lastFetchedAt: now } })
        .catch((err: unknown) => this.logger.warn(`Could not record a calendar fetch: ${(err as Error).message}`));
    }
    const owner: FeedOwner = { id: feed.user.id, locale: feed.user.locale };
    const description =
      owner.locale === 'ar'
        ? 'جلسات دوراتك في أكاديمية MLOps MENA. هذا الرابط خاص بك، فلا تشاركه.'
        : 'Your MLOps MENA Academy course sessions. This link is private to you; please do not share it.';
    return buildIcs(FEED_NAME, await this.collectEvents(owner), now, { refreshInterval: REFRESH_INTERVAL, description });
  }

  /**
   * Every event in a student's feed. This is the extension point: each source
   * returns its own events (with UIDs that can't collide, e.g. `event-<id>` for
   * live-session registrations) and they are merged here.
   */
  async collectEvents(owner: FeedOwner): Promise<IcsEvent[]> {
    const sources: Array<(o: FeedOwner) => Promise<IcsEvent[]>> = [(o) => this.courseSessionEvents(o)];
    const events = (await Promise.all(sources.map((source) => source(owner)))).flat();
    return events.sort((a, b) => a.start.getTime() - b.start.getTime());
  }

  /**
   * Sessions of every running course the student is enrolled in. A session that
   * is deleted, or a course that is archived or unpublished, drops out of the
   * feed, and calendar apps remove the event on their next refresh.
   */
  private async courseSessionEvents(owner: FeedOwner): Promise<IcsEvent[]> {
    const sessions = await this.prisma.courseSession.findMany({
      where: { course: { status: { in: ['OPEN', 'CLOSED'] }, enrollments: { some: { userId: owner.id } } } },
      // An explicit select keeps liveUrl, recordings and materials out by construction.
      select: {
        id: true,
        order: true,
        titleEn: true,
        titleAr: true,
        startsAt: true,
        durationMin: true,
        updatedAt: true,
        course: { select: { slug: true, titleEn: true, titleAr: true } },
      },
      orderBy: { startsAt: 'asc' },
    });
    return sessions.map((s) => courseSessionEvent(s, s.course, owner.locale, this.env.WEB_URL));
  }
}
