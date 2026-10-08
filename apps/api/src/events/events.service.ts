import { ConflictException, ForbiddenException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { DEFAULT_TIMEZONE, eventEnded, googleCalendarLink, isValidTimezone, liveLinkVisible, type PublicEventDto } from '@academy/shared';
import { Prisma, type LiveEvent } from '@prisma/client';
import type { AuthUser } from '../common/decorators';
import { EmailService } from '../email/email.service';
import { buildIcs } from '../learn/ics';
import { PrismaService } from '../prisma/prisma.service';
import { SettingsService } from '../settings/settings.service';

const PUBLIC_STATUSES = ['PUBLISHED', 'CANCELLED'] as const;

/** Free live sessions: public listing, one-click registration, link revealed near the start. */
@Injectable()
export class EventsService {
  private readonly logger = new Logger(EventsService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly email: EmailService,
    private readonly settings: SettingsService,
  ) {}

  private async toDto(e: LiveEvent & { _count: { registrations: number } }, viewer?: AuthUser, now = new Date()): Promise<PublicEventDto> {
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
      recordingUrl: e.recordingUrl,
      past: eventEnded(e.startsAt, e.durationMin, now),
      capacity: e.capacity,
      registered: e._count.registrations,
      full: e.capacity !== null && e._count.registrations >= e.capacity,
    };
    if (viewer) {
      const reg = await this.prisma.eventRegistration.findUnique({ where: { eventId_userId: { eventId: e.id, userId: viewer.id } } });
      const { liveLinkRevealMinutes } = await this.settings.get();
      const visible = Boolean(reg) && e.status === 'PUBLISHED' && liveLinkVisible(e.startsAt, e.durationMin, liveLinkRevealMinutes, now);
      dto.me = {
        registered: Boolean(reg),
        liveUrl: visible ? e.liveUrl : null,
        liveUrlFrom: new Date(e.startsAt.getTime() - liveLinkRevealMinutes * 60_000).toISOString(),
      };
    }
    return dto;
  }

  async list(now = new Date()): Promise<{ upcoming: PublicEventDto[]; past: PublicEventDto[] }> {
    const rows = await this.prisma.liveEvent.findMany({
      where: { status: { in: [...PUBLIC_STATUSES] } },
      orderBy: { startsAt: 'asc' },
      include: { _count: { select: { registrations: true } } },
    });
    const all = await Promise.all(rows.map((e) => this.toDto(e, undefined, now)));
    return {
      upcoming: all.filter((e) => !e.past && e.status === 'PUBLISHED'),
      // Past sessions newest first; cancelled ones aren't worth showing once over.
      past: all.filter((e) => e.past && e.status === 'PUBLISHED').reverse(),
    };
  }

  private async find(slug: string) {
    const e = await this.prisma.liveEvent.findUnique({ where: { slug }, include: { _count: { select: { registrations: true } } } });
    if (!e || !(PUBLIC_STATUSES as readonly string[]).includes(e.status)) throw new NotFoundException('Session not found');
    return e;
  }

  async get(slug: string, viewer?: AuthUser): Promise<PublicEventDto> {
    return this.toDto(await this.find(slug), viewer);
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
    if (event.status !== 'PUBLISHED' || eventEnded(event.startsAt, event.durationMin)) {
      throw new ConflictException({ code: 'EVENT_CLOSED', message: 'Registration for this session is closed' });
    }
    let created = false;
    await this.prisma.$transaction(async (tx) => {
      // Serialise registrations per event so capacity can't be oversold.
      await tx.$queryRaw`SELECT id FROM "LiveEvent" WHERE id = ${event.id} FOR NO KEY UPDATE`;
      const existing = await tx.eventRegistration.findUnique({ where: { eventId_userId: { eventId: event.id, userId: user.id } } });
      if (existing) return;
      if (event.capacity !== null && (await tx.eventRegistration.count({ where: { eventId: event.id } })) >= event.capacity) {
        throw new ConflictException({ code: 'EVENT_FULL', message: 'This session is full' });
      }
      await tx.eventRegistration.create({ data: { eventId: event.id, userId: user.id } });
      created = true;
    });
    if (created) {
      const locale = account.locale === 'ar' ? 'ar' : 'en';
      const title = locale === 'ar' ? event.titleAr || event.titleEn : event.titleEn;
      const url = this.email.url(locale, `/sessions/${event.slug}`);
      void this.email
        .send(account.email, locale, {
          name: 'eventRegistered',
          title,
          when: formatWhen(event.startsAt, locale, account.profile?.timezone),
          url,
          // The public page, not the live link: calendars get shared and synced.
          calendarUrl: googleCalendarLink({
            title,
            start: event.startsAt,
            end: new Date(event.startsAt.getTime() + event.durationMin * 60_000),
            details: url,
            location: url,
          }),
        })
        .catch(() => undefined);
    }
    return this.get(slug, user);
  }

  async unregister(user: AuthUser, slug: string): Promise<PublicEventDto> {
    const event = await this.find(slug);
    await this.prisma.eventRegistration.deleteMany({ where: { eventId: event.id, userId: user.id } });
    return this.get(slug, user);
  }

  /** The viewer's registrations for sessions that haven't ended yet, soonest first (dashboard). */
  async mine(user: AuthUser, now = new Date()): Promise<PublicEventDto[]> {
    const rows = await this.prisma.liveEvent.findMany({
      where: {
        status: { in: [...PUBLIC_STATUSES] },
        registrations: { some: { userId: user.id } },
        // Sessions last at most 10 hours; the exact "ended" check happens below.
        startsAt: { gte: new Date(now.getTime() - 600 * 60_000) },
      },
      orderBy: { startsAt: 'asc' },
      take: 20,
      include: { _count: { select: { registrations: true } } },
    });
    const all = await Promise.all(rows.map((e) => this.toDto(e, user, now)));
    return all.filter((e) => !e.past);
  }

  /** Calendar file without the live link (it's revealed on the page near the start). */
  async ics(slug: string, webUrl: string): Promise<{ filename: string; body: string }> {
    const e = await this.find(slug);
    const url = `${webUrl}/en/sessions/${e.slug}`;
    return {
      filename: `${e.slug}.ics`,
      body: buildIcs(e.titleEn, [
        {
          uid: `event-${e.id}@academy.mlopsmena.com`,
          title: e.titleEn,
          description: `Live session by MLOps MENA Academy. The join link appears on ${url} shortly before the start.`,
          url,
          start: e.startsAt,
          durationMin: e.durationMin,
          updatedAt: e.updatedAt,
        },
      ]),
    };
  }

  // ------------------------------------------------------------------ admin

  adminList() {
    return this.prisma.liveEvent.findMany({ orderBy: { startsAt: 'desc' }, include: { _count: { select: { registrations: true } } } });
  }

  async adminGet(id: string) {
    const e = await this.prisma.liveEvent.findUnique({ where: { id }, include: { _count: { select: { registrations: true } } } });
    if (!e) throw new NotFoundException('Session not found');
    return e;
  }

  async save(input: Prisma.LiveEventCreateInput, id?: string) {
    try {
      return id ? await this.prisma.liveEvent.update({ where: { id }, data: input }) : await this.prisma.liveEvent.create({ data: input });
    } catch (err) {
      if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') {
        throw new ConflictException({ code: 'SLUG_TAKEN', message: 'Another session already uses this slug' });
      }
      if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2025') throw new NotFoundException('Session not found');
      throw err;
    }
  }

  async remove(id: string) {
    const r = await this.prisma.liveEvent.deleteMany({ where: { id } });
    if (!r.count) throw new NotFoundException('Session not found');
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
