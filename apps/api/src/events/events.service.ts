import { ConflictException, ForbiddenException, Inject, Injectable, NotFoundException } from '@nestjs/common';
import {
  DEFAULT_TIMEZONE,
  eventEnded,
  googleCalendarLink,
  isValidTimezone,
  liveLinkVisible,
  type Locale,
  type PublicEventDto,
} from '@academy/shared';
import { Prisma, type LiveEvent } from '@prisma/client';
import { AuditService } from '../audit/audit.service';
import type { AuthUser } from '../common/decorators';
import { ENV } from '../config/config.module';
import type { Env } from '../config/env';
import { EmailService } from '../email/email.service';
import { buildIcs } from '../learn/ics';
import { PrismaService } from '../prisma/prisma.service';
import { SettingsService } from '../settings/settings.service';

const PUBLIC_STATUSES = ['PUBLISHED', 'CANCELLED'] as const;
/** Sessions last at most 10 hours (schema max); used to narrow "not ended yet" queries. */
const MAX_DURATION_MS = 600 * 60_000;
/** The public list shows recently ended sessions only, so it stays small forever. */
const RECENT_PAST_DAYS = 60;
const RECENT_PAST_LIMIT = 20;

/** Registrations that count: deleted accounts don't hold seats. */
const withCount = { _count: { select: { registrations: { where: { user: { deletedAt: null } } } } } } satisfies Prisma.LiveEventInclude;
type EventWithCount = LiveEvent & { _count: { registrations: number } };

/** The viewer's side of one event, computed once per request. */
interface ViewerContext {
  registered: boolean;
  revealMinutes: number;
}

/** Free live sessions: public listing, one-click registration, link revealed near the start. */
@Injectable()
export class EventsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly email: EmailService,
    private readonly settings: SettingsService,
    private readonly audit: AuditService,
    @Inject(ENV) private readonly env: Env,
  ) {}

  private toDto(e: EventWithCount, viewer?: ViewerContext, now = new Date()): PublicEventDto {
    const past = eventEnded(e.startsAt, e.durationMin, now);
    const dto: PublicEventDto = {
      slug: e.slug,
      status: e.status,
      titleEn: e.titleEn,
      titleAr: e.titleAr || e.titleEn,
      descriptionEn: e.descriptionEn,
      descriptionAr: e.descriptionAr || e.descriptionEn,
      speakerName: e.speakerName,
      speakerNameAr: e.speakerNameAr || e.speakerName,
      speakerTitleEn: e.speakerTitleEn,
      speakerTitleAr: e.speakerTitleAr || e.speakerTitleEn,
      speakerPhotoUrl: e.speakerPhotoUrl,
      speakerLinkedinUrl: e.speakerLinkedinUrl,
      startsAt: e.startsAt.toISOString(),
      durationMin: e.durationMin,
      language: e.language,
      platform: e.platform,
      coverImageUrl: e.coverImageUrl,
      recordingUrl: past ? e.recordingUrl : null,
      past,
      capacity: e.capacity,
      registered: e._count.registrations,
      full: e.capacity !== null && e._count.registrations >= e.capacity,
    };
    if (viewer) {
      const visible = viewer.registered && e.status === 'PUBLISHED' && liveLinkVisible(e.startsAt, e.durationMin, viewer.revealMinutes, now);
      dto.me = {
        registered: viewer.registered,
        liveUrl: visible ? e.liveUrl : null,
        liveUrlFrom: new Date(e.startsAt.getTime() - viewer.revealMinutes * 60_000).toISOString(),
      };
    }
    return dto;
  }

  /** Upcoming sessions, plus the most recently ended ones (newest first). */
  async list(now = new Date()): Promise<{ upcoming: PublicEventDto[]; past: PublicEventDto[] }> {
    const [current, recent] = await Promise.all([
      this.prisma.liveEvent.findMany({
        where: { status: 'PUBLISHED', startsAt: { gte: new Date(now.getTime() - MAX_DURATION_MS) } },
        orderBy: { startsAt: 'asc' },
        include: withCount,
      }),
      this.prisma.liveEvent.findMany({
        where: { status: 'PUBLISHED', startsAt: { gte: new Date(now.getTime() - RECENT_PAST_DAYS * 86_400_000), lte: now } },
        orderBy: { startsAt: 'desc' },
        take: RECENT_PAST_LIMIT,
        include: withCount,
      }),
    ]);
    return {
      upcoming: current.map((e) => this.toDto(e, undefined, now)).filter((e) => !e.past),
      past: recent.map((e) => this.toDto(e, undefined, now)).filter((e) => e.past),
    };
  }

  private async find(slug: string): Promise<EventWithCount> {
    const e = await this.prisma.liveEvent.findUnique({ where: { slug }, include: withCount });
    if (!e || !(PUBLIC_STATUSES as readonly string[]).includes(e.status)) throw new NotFoundException('Session not found');
    return e;
  }

  private async revealMinutes(): Promise<number> {
    return (await this.settings.get()).liveLinkRevealMinutes;
  }

  async get(slug: string, viewer?: AuthUser): Promise<PublicEventDto> {
    const e = await this.find(slug);
    if (!viewer) return this.toDto(e);
    const [reg, revealMinutes] = await Promise.all([
      this.prisma.eventRegistration.findUnique({ where: { eventId_userId: { eventId: e.id, userId: viewer.id } }, select: { id: true } }),
      this.revealMinutes(),
    ]);
    return this.toDto(e, { registered: Boolean(reg), revealMinutes });
  }

  /** The viewer's registrations for sessions that haven't ended yet, soonest first (dashboard). */
  async mine(user: AuthUser, now = new Date()): Promise<PublicEventDto[]> {
    const [rows, revealMinutes] = await Promise.all([
      this.prisma.liveEvent.findMany({
        where: {
          status: { in: [...PUBLIC_STATUSES] },
          registrations: { some: { userId: user.id } },
          startsAt: { gte: new Date(now.getTime() - MAX_DURATION_MS) },
        },
        orderBy: { startsAt: 'asc' },
        take: 20,
        include: withCount,
      }),
      this.revealMinutes(),
    ]);
    return rows.map((e) => this.toDto(e, { registered: true, revealMinutes }, now)).filter((e) => !e.past);
  }

  async register(user: AuthUser, slug: string): Promise<PublicEventDto> {
    const account = await this.prisma.user.findUniqueOrThrow({
      where: { id: user.id },
      select: { email: true, locale: true, emailVerifiedAt: true, profile: { select: { timezone: true } } },
    });
    if (!account.emailVerifiedAt) {
      throw new ForbiddenException({ code: 'EMAIL_NOT_VERIFIED', message: 'Confirm your email address before registering' });
    }
    const event = await this.find(slug);
    let created = false;
    await this.prisma.$transaction(async (tx) => {
      // Serialise registrations per event, and read status/capacity under the lock so a
      // cancellation or a lowered capacity saved a moment ago is respected.
      const [locked] = await tx.$queryRaw<{ status: string; capacity: number | null; startsAt: Date; durationMin: number }[]>`
        SELECT status::text AS status, capacity, "startsAt", "durationMin" FROM "LiveEvent" WHERE id = ${event.id} FOR NO KEY UPDATE`;
      if (!locked || locked.status !== 'PUBLISHED' || eventEnded(locked.startsAt, locked.durationMin)) {
        throw new ConflictException({ code: 'EVENT_CLOSED', message: 'Registration for this session is closed' });
      }
      const existing = await tx.eventRegistration.findUnique({ where: { eventId_userId: { eventId: event.id, userId: user.id } } });
      if (existing) return;
      if (
        locked.capacity !== null &&
        (await tx.eventRegistration.count({ where: { eventId: event.id, user: { deletedAt: null } } })) >= locked.capacity
      ) {
        throw new ConflictException({ code: 'EVENT_FULL', message: 'This session is full' });
      }
      await tx.eventRegistration.create({ data: { eventId: event.id, userId: user.id } });
      created = true;
    });
    if (created) {
      // One confirmation per person and session: re-registering doesn't send another.
      const first = await this.prisma.eventConfirmation.createMany({ data: [{ eventId: event.id, userId: user.id }], skipDuplicates: true });
      if (first.count) {
        const locale: Locale = account.locale === 'ar' ? 'ar' : 'en';
        void this.email
          .send(account.email, locale, { name: 'eventRegistered', ...this.mailFields(event, locale, account.profile?.timezone) })
          .catch(() => undefined);
      }
    }
    return this.get(slug, user);
  }

  async unregister(user: AuthUser, slug: string): Promise<PublicEventDto> {
    const event = await this.find(slug);
    // Keep the record of who attended once it's over.
    if (eventEnded(event.startsAt, event.durationMin)) {
      throw new ConflictException({ code: 'EVENT_CLOSED', message: 'This session has ended' });
    }
    await this.prisma.eventRegistration.deleteMany({ where: { eventId: event.id, userId: user.id } });
    return this.get(slug, user);
  }

  /** Title, time, page and calendar links for an email. Calendars get the public page, never the live link. */
  private mailFields(e: LiveEvent, locale: Locale, timezone?: string | null) {
    const title = locale === 'ar' ? e.titleAr || e.titleEn : e.titleEn;
    const url = this.email.url(locale, `/sessions/${e.slug}`);
    return {
      title,
      when: formatWhen(e.startsAt, locale, timezone),
      url,
      calendarUrl: googleCalendarLink({
        title,
        start: e.startsAt,
        end: new Date(e.startsAt.getTime() + e.durationMin * 60_000),
        details: url,
        location: url,
      }),
      icsUrl: `${this.env.WEB_URL}/api/events/${e.slug}/calendar.ics?locale=${locale}`,
    };
  }

  /** Calendar file without the live link (it's revealed on the page near the start). */
  async ics(slug: string, locale: Locale = 'en'): Promise<{ filename: string; body: string }> {
    const e = await this.find(slug);
    const ar = locale === 'ar';
    const title = ar ? e.titleAr || e.titleEn : e.titleEn;
    const url = `${this.env.WEB_URL}/${locale}/sessions/${e.slug}`;
    return {
      filename: `${e.slug}.ics`,
      body: buildIcs(title, [
        {
          uid: `event-${e.id}`,
          title,
          description: ar
            ? `جلسة مباشرة من أكاديمية MLOps MENA. يظهر رابط الانضمام في ${url} قبل البدء بوقت قصير.`
            : `Live session by MLOps MENA Academy. The join link appears on ${url} shortly before the start.`,
          url,
          start: e.startsAt,
          durationMin: e.durationMin,
          updatedAt: e.updatedAt,
          cancelled: e.status === 'CANCELLED',
        },
      ]),
    };
  }

  // ------------------------------------------------------------------ admin

  adminList() {
    return this.prisma.liveEvent.findMany({ orderBy: { startsAt: 'desc' }, include: withCount });
  }

  async adminGet(id: string) {
    const e = await this.prisma.liveEvent.findUnique({ where: { id }, include: withCount });
    if (!e) throw new NotFoundException('Session not found');
    return e;
  }

  /**
   * Creates or updates a session. A new time resets the reminders (so the 24h and 1h
   * reminders go out again for the new time) and tells registrants; cancelling tells them too.
   */
  async save(input: Prisma.LiveEventCreateInput, actorId: string, id?: string): Promise<LiveEvent> {
    const before = id ? await this.prisma.liveEvent.findUnique({ where: { id } }) : null;
    if (id && !before) throw new NotFoundException('Session not found');
    let saved: LiveEvent;
    try {
      saved = await this.prisma.$transaction(async (tx) => {
        const e = id ? await tx.liveEvent.update({ where: { id }, data: input }) : await tx.liveEvent.create({ data: input });
        if (before && before.startsAt.getTime() !== e.startsAt.getTime()) {
          await tx.eventReminderLog.deleteMany({ where: { eventId: e.id } });
        }
        return e;
      });
    } catch (err) {
      if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') {
        throw new ConflictException({ code: 'SLUG_TAKEN', message: 'Another session already uses this slug' });
      }
      if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2025') throw new NotFoundException('Session not found');
      throw err;
    }

    const rescheduled = Boolean(before && before.startsAt.getTime() !== saved.startsAt.getTime());
    const metadata: Record<string, unknown> = { slug: saved.slug };
    if (!before) metadata.status = saved.status;
    if (before && before.status !== saved.status) metadata.status = { from: before.status, to: saved.status };
    if (before && rescheduled) metadata.startsAt = { from: before.startsAt.toISOString(), to: saved.startsAt.toISOString() };
    if (before && before.durationMin !== saved.durationMin) metadata.durationMin = { from: before.durationMin, to: saved.durationMin };
    if (before && (before.liveUrl ?? null) !== (saved.liveUrl ?? null)) metadata.liveUrlChanged = true;
    await this.audit.log({ actorId, action: before ? 'event.updated' : 'event.created', entityType: 'LiveEvent', entityId: saved.id, metadata });

    if (before?.status === 'PUBLISHED' && saved.status === 'CANCELLED') {
      await this.notifyRegistrants(saved, 'eventCancelled');
    } else if (rescheduled && before?.status === 'PUBLISHED' && saved.status === 'PUBLISHED' && !eventEnded(saved.startsAt, saved.durationMin)) {
      await this.notifyRegistrants(saved, 'eventRescheduled');
    }
    return saved;
  }

  /** Queues one email per registrant on the bulk lane (they don't hold up sign-ins or resets). */
  private async notifyRegistrants(e: LiveEvent, kind: 'eventRescheduled' | 'eventCancelled'): Promise<number> {
    const regs = await this.prisma.eventRegistration.findMany({
      where: { eventId: e.id, user: { deletedAt: null } },
      select: { user: { select: { email: true, locale: true, profile: { select: { timezone: true } } } } },
    });
    for (const { user } of regs) {
      const locale: Locale = user.locale === 'ar' ? 'ar' : 'en';
      const f = this.mailFields(e, locale, user.profile?.timezone);
      void this.email
        .send(
          user.email,
          locale,
          kind === 'eventRescheduled'
            ? { name: 'eventRescheduled', ...f }
            : { name: 'eventCancelled', title: f.title, when: f.when, url: this.email.url(locale, '/sessions') },
          { bulk: true },
        )
        .catch(() => undefined);
    }
    return regs.length;
  }

  /**
   * Deletes a session. One that people registered for must be cancelled instead (so
   * they are told); a draft, cancelled or empty session can go.
   */
  async remove(id: string, actorId: string): Promise<void> {
    const e = await this.adminGet(id);
    const registrations = e._count.registrations;
    if (registrations > 0 && e.status !== 'CANCELLED') {
      throw new ConflictException({
        code: 'EVENT_HAS_REGISTRATIONS',
        message: `${registrations} people registered for this session. Set its status to Cancelled instead: they will be told by email.`,
      });
    }
    await this.prisma.liveEvent.delete({ where: { id } });
    await this.audit.log({
      actorId,
      action: 'event.deleted',
      entityType: 'LiveEvent',
      entityId: id,
      metadata: { slug: e.slug, status: e.status, registrations },
    });
  }

  async registrations(id: string) {
    await this.adminGet(id);
    const rows = await this.prisma.eventRegistration.findMany({
      where: { eventId: id, user: { deletedAt: null } },
      orderBy: { createdAt: 'asc' },
      include: {
        user: {
          select: {
            id: true,
            email: true,
            profile: { select: { fullNameEn: true, country: true, jobTitle: true, experienceYears: true, seniority: true } },
          },
        },
      },
    });
    return rows.map((r) => ({
      userId: r.user.id,
      email: r.user.email,
      name: r.user.profile?.fullNameEn ?? null,
      country: r.user.profile?.country ?? null,
      jobTitle: r.user.profile?.jobTitle ?? null,
      experienceYears: r.user.profile?.experienceYears ?? null,
      seniority: r.user.profile?.seniority ?? null,
      registeredAt: r.createdAt.toISOString(),
    }));
  }
}

/** "Sunday 18 October, 19:00 EEST" in the reader's language and time zone. */
export function formatWhen(at: Date, locale: 'en' | 'ar', timezone?: string | null): string {
  const timeZone = timezone && isValidTimezone(timezone) ? timezone : DEFAULT_TIMEZONE;
  return new Intl.DateTimeFormat(locale === 'ar' ? 'ar-EG-u-nu-latn' : 'en-GB', {
    weekday: 'long',
    day: 'numeric',
    month: 'long',
    hour: '2-digit',
    minute: '2-digit',
    timeZone,
    timeZoneName: 'short',
  }).format(at);
}
