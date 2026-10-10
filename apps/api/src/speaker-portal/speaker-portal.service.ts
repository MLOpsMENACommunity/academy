import { BadRequestException, ConflictException, ForbiddenException, Inject, Injectable, Logger, NotFoundException } from '@nestjs/common';
import {
  cancelDeadline,
  canCancelBooking,
  eventEnded,
  generateSlotTimes,
  googleCalendarLink,
  MAX_GENERATED_SLOTS,
  slugify,
  type AdminSlotDto,
  type AdminSpeakerApplicationDto,
  type Locale,
  type SlotBookingInput,
  type SlotGeneratorInput,
  type SlotInput,
  type SpeakerApplicationDto,
  type SpeakerApplicationFilter,
  type SpeakerApplicationInput,
  type SpeakerBookingDto,
  type SpeakerPortalDto,
  type SpeakerReviewInput,
  type SpeakingSlotDto,
} from '@academy/shared';
import { Prisma, type LiveEvent, type SpeakerApplication, type SpeakingSlot, type User } from '@prisma/client';
import { freeInstructorSlug } from '../admin/admin-courses.service';
import { AuditService } from '../audit/audit.service';
import { ENV } from '../config/config.module';
import type { Env } from '../config/env';
import { EmailService } from '../email/email.service';
import { EventsService, formatWhen } from '../events/events.service';
import { buildIcs } from '../learn/ics';
import { NotificationsService } from '../notifications/notifications.service';
import { PrismaService } from '../prisma/prisma.service';
import { SettingsService } from '../settings/settings.service';

/** Open slots a speaker sees: from now until this far ahead. */
const SLOT_HORIZON_DAYS = 180;

/** The earliest start a speaker can book: at least the cancel window ahead (and never in the past). */
function bookableFrom(now: Date, cancelDays: number): Date {
  return new Date(now.getTime() + cancelDays * 86_400_000);
}

type SlotWithEvent = SpeakingSlot & {
  event: (Pick<LiveEvent, 'id' | 'slug' | 'status' | 'recordingUrl' | 'startsAt' | 'durationMin'> & { _count: { registrations: number } }) | null;
};

const eventSelect = {
  select: {
    id: true,
    slug: true,
    status: true,
    recordingUrl: true,
    startsAt: true,
    durationMin: true,
    _count: { select: { registrations: { where: { user: { deletedAt: null } } } } },
  },
} satisfies Prisma.SpeakingSlot$eventArgs;

function toApplicationDto(a: SpeakerApplication, email: string): SpeakerApplicationDto {
  return {
    id: a.id,
    status: a.status,
    fullName: a.fullName,
    email,
    phone: a.phone,
    linkedinUrl: a.linkedinUrl,
    title: a.title,
    company: a.company,
    country: a.country,
    bio: a.bio,
    photoUrl: a.photoUrl,
    areas: a.areas,
    sessionTitle: a.sessionTitle,
    abstract: a.abstract,
    format: a.format,
    language: a.language,
    preferredMonths: a.preferredMonths,
    reviewNote: a.reviewNote,
    submittedAt: a.submittedAt.toISOString(),
    reviewedAt: a.reviewedAt?.toISOString() ?? null,
    submissions: a.submissions,
  };
}

/**
 * The speaker portal: speakers apply, the team approves, the team publishes monthly slots,
 * approved speakers book one, and every booking becomes a DRAFT live session the team
 * finishes and publishes as usual.
 */
@Injectable()
export class SpeakerPortalService {
  private readonly logger = new Logger(SpeakerPortalService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly email: EmailService,
    private readonly settings: SettingsService,
    private readonly audit: AuditService,
    private readonly notifications: NotificationsService,
    private readonly events: EventsService,
    @Inject(ENV) private readonly env: Env,
  ) {}

  // ------------------------------------------------------------------ speaker side

  async portal(userId: string, now = new Date()): Promise<SpeakerPortalDto> {
    const [user, settings, slots] = await Promise.all([
      this.prisma.user.findUniqueOrThrow({
        where: { id: userId },
        select: {
          email: true,
          locale: true,
          speakerApplication: true,
          speakerProfile: { select: { slug: true, events: { where: { status: 'PUBLISHED' }, select: { id: true }, take: 1 } } },
        },
      }),
      this.settings.get(),
      this.prisma.speakingSlot.findMany({
        where: { bookedById: userId, status: 'BOOKED' },
        orderBy: { startsAt: 'desc' },
        take: 50,
        include: { event: eventSelect },
      }),
    ]);
    const locale: Locale = user.locale === 'ar' ? 'ar' : 'en';
    const profile = user.speakerProfile;
    return {
      application: user.speakerApplication ? toApplicationDto(user.speakerApplication, user.email) : null,
      speakerPageSlug: profile?.slug && profile.events.length ? profile.slug : null,
      bookings: slots.map((s) => this.toBookingDto(s, settings.speakerCancelDays, locale, now)),
      rules: { maxOpenBookings: settings.speakerMaxOpenBookings, cancelDays: settings.speakerCancelDays },
    };
  }

  private toBookingDto(s: SlotWithEvent, cancelDays: number, locale: Locale, now: Date): SpeakerBookingDto {
    const title = s.title ?? '';
    const startsAt = s.event?.startsAt ?? s.startsAt;
    const durationMin = s.event?.durationMin ?? s.durationMin;
    const page = this.email.url(locale, '/speaker');
    const past = eventEnded(startsAt, durationMin, now);
    return {
      slotId: s.id,
      startsAt: startsAt.toISOString(),
      durationMin,
      title,
      past,
      canCancel: !past && canCancelBooking(startsAt, cancelDays, now),
      cancelUntil: cancelDeadline(startsAt, cancelDays).toISOString(),
      calendarUrl: googleCalendarLink({ title, start: startsAt, end: new Date(startsAt.getTime() + durationMin * 60_000), details: page }),
      icsUrl: `${this.env.WEB_URL}/api/speaker/slots/${s.id}/calendar.ics?locale=${locale}`,
      event: s.event
        ? {
            slug: s.event.slug,
            status: s.event.status,
            recordingUrl: past ? s.event.recordingUrl : null,
            registered: s.event._count.registrations,
          }
        : null,
    };
  }

  /** First application, an edit while it waits, or a new try after a rejection. */
  async submitApplication(userId: string, input: SpeakerApplicationInput): Promise<SpeakerApplicationDto> {
    const user = await this.prisma.user.findUniqueOrThrow({ where: { id: userId }, select: { email: true, speakerApplication: true } });
    const current = user.speakerApplication;
    if (current?.status === 'APPROVED') {
      throw new ConflictException({ code: 'SPEAKER_ALREADY_APPROVED', message: 'Your application is already approved. Ask the team to change your public profile.' });
    }
    const data = { ...input, company: input.company ?? '', photoUrl: input.photoUrl ?? null };
    const resubmitted = current?.status === 'REJECTED';
    const saved = current
      ? await this.prisma.speakerApplication.update({
          where: { id: current.id },
          data: {
            ...data,
            status: 'SUBMITTED',
            ...(resubmitted ? { submissions: { increment: 1 }, submittedAt: new Date(), reviewNote: null, reviewedAt: null, reviewedById: null } : {}),
          },
        })
      : await this.prisma.speakerApplication.create({ data: { ...data, userId } });
    await this.audit.log({
      actorId: userId,
      action: !current ? 'speaker_application.submitted' : resubmitted ? 'speaker_application.resubmitted' : 'speaker_application.updated',
      entityType: 'SpeakerApplication',
      entityId: saved.id,
    });
    if (!current || resubmitted) {
      await this.notifications.notifyAdmins({
        type: 'speaker_application',
        titleEn: 'New speaker application',
        titleAr: 'طلب متحدث جديد',
        bodyEn: `${saved.fullName}: ${saved.sessionTitle}`,
        bodyAr: `${saved.fullName}: ${saved.sessionTitle}`,
        link: `/admin/speakers/applications/${saved.id}`,
      });
    }
    return toApplicationDto(saved, user.email);
  }

  private async assertApproved(userId: string): Promise<void> {
    const app = await this.prisma.speakerApplication.findUnique({ where: { userId }, select: { status: true } });
    if (app?.status !== 'APPROVED') {
      throw new ForbiddenException({ code: 'SPEAKER_NOT_APPROVED', message: 'You can book a slot once the team approves your application' });
    }
  }

  /** Open slots from now on, soonest first. Only approved speakers see them. */
  async openSlots(userId: string, now = new Date()): Promise<SpeakingSlotDto[]> {
    await this.assertApproved(userId);
    const { speakerCancelDays } = await this.settings.get();
    const rows = await this.prisma.speakingSlot.findMany({
      // Bookable only while it could still be cancelled: never a session the team can't prepare.
      where: { status: 'OPEN', startsAt: { gt: bookableFrom(now, speakerCancelDays), lt: new Date(now.getTime() + SLOT_HORIZON_DAYS * 86_400_000) } },
      orderBy: { startsAt: 'asc' },
      take: 300,
    });
    return rows.map((s) => ({ id: s.id, startsAt: s.startsAt.toISOString(), durationMin: s.durationMin }));
  }

  /** A free slug for the draft session: "serving-llms-on-kubernetes-2026-11-07". */
  private async freeEventSlug(tx: Prisma.TransactionClient, title: string, startsAt: Date): Promise<string> {
    const base = `${slugify(title, 60) || 'session'}-${startsAt.toISOString().slice(0, 10)}`;
    for (let n = 1; ; n++) {
      const candidate = n === 1 ? base : `${base}-${n}`;
      if (!(await tx.liveEvent.findUnique({ where: { slug: candidate }, select: { id: true } }))) return candidate;
    }
  }

  /**
   * Books a slot. In one transaction: the speaker's row is locked (so two requests can't
   * both pass the open-bookings limit), the slot flips OPEN → BOOKED only if it is still
   * OPEN (so two speakers can't hold it), and the DRAFT session is created and linked.
   */
  async book(userId: string, slotId: string, input: SlotBookingInput, now = new Date()): Promise<SpeakerBookingDto> {
    const settings = await this.settings.get();
    // Two bookings with the same title on the same day can race for one slug: try again.
    for (let attempt = 0; ; attempt++) {
      try {
        return await this.bookOnce(userId, slotId, input, settings, now);
      } catch (err) {
        if (attempt < 2 && err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') continue;
        throw err;
      }
    }
  }

  private async bookOnce(
    userId: string,
    slotId: string,
    input: SlotBookingInput,
    settings: Awaited<ReturnType<SettingsService['get']>>,
    now: Date,
  ): Promise<SpeakerBookingDto> {
    const { slot, event, user } = await this.prisma.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT id FROM "User" WHERE id = ${userId} FOR UPDATE`;
      const [account, app] = await Promise.all([
        tx.user.findUniqueOrThrow({ where: { id: userId }, select: { id: true, email: true, locale: true, deletedAt: true, speakerProfile: { select: { id: true } } } }),
        tx.speakerApplication.findUnique({ where: { userId } }),
      ]);
      if (app?.status !== 'APPROVED' || !account.speakerProfile) {
        throw new ForbiddenException({ code: 'SPEAKER_NOT_APPROVED', message: 'You can book a slot once the team approves your application' });
      }
      const open = await tx.speakingSlot.count({ where: { bookedById: userId, status: 'BOOKED', startsAt: { gt: now } } });
      if (open >= settings.speakerMaxOpenBookings) {
        throw new ConflictException({
          code: 'BOOKING_LIMIT',
          message: `You already have ${open} upcoming booking${open === 1 ? '' : 's'} (the limit is ${settings.speakerMaxOpenBookings}).`,
        });
      }
      const claimed = await tx.speakingSlot.updateMany({
        where: { id: slotId, status: 'OPEN', startsAt: { gt: bookableFrom(now, settings.speakerCancelDays) } },
        data: { status: 'BOOKED', bookedById: userId, bookedAt: now, title: input.title, abstract: input.abstract },
      });
      if (claimed.count !== 1) {
        throw new ConflictException({ code: 'SLOT_TAKEN', message: 'This slot was just booked or is no longer available. Choose another one.' });
      }
      const s = await tx.speakingSlot.findUniqueOrThrow({ where: { id: slotId } });
      const e = await tx.liveEvent.create({
        data: {
          slug: await this.freeEventSlug(tx, input.title, s.startsAt),
          status: 'DRAFT',
          titleEn: input.title,
          descriptionEn: input.abstract,
          speakerId: account.speakerProfile.id,
          startsAt: s.startsAt,
          durationMin: s.durationMin,
          language: app.language,
          platform: 'GOOGLE_MEET',
          source: 'speaker-booking',
        },
      });
      const linked = await tx.speakingSlot.update({ where: { id: slotId }, data: { eventId: e.id }, include: { event: eventSelect } });
      await this.audit.log({ actorId: userId, action: 'speaking_slot.booked', entityType: 'SpeakingSlot', entityId: slotId, metadata: { eventId: e.id } }, tx);
      await this.audit.log({ actorId: userId, action: 'event.created', entityType: 'LiveEvent', entityId: e.id, metadata: { slug: e.slug, status: 'DRAFT', source: 'speaker-booking' } }, tx);
      return { slot: linked, event: e, user: account };
    });

    const locale: Locale = user.locale === 'ar' ? 'ar' : 'en';
    const app = await this.prisma.speakerApplication.findUniqueOrThrow({ where: { userId }, select: { fullName: true } });
    const dto = this.toBookingDto(slot, settings.speakerCancelDays, locale, now);
    // The speaker's confirmation, then the session team (each address its own email, bulk lane).
    void this.email
      .send(user.email, locale, {
        name: 'speakerBookingConfirmed',
        title: input.title,
        when: formatWhen(slot.startsAt, locale),
        cancelUntil: formatWhen(new Date(dto.cancelUntil), locale),
        url: this.email.url(locale, '/speaker'),
        calendarUrl: dto.calendarUrl,
        icsUrl: dto.icsUrl,
      })
      .catch(() => undefined);
    await this.tellTeam(settings.sessionTeamEmails, {
      kind: 'booked',
      speakerName: app.fullName,
      speakerEmail: user.email,
      title: input.title,
      abstract: input.abstract,
      when: formatWhen(slot.startsAt, 'en'),
      url: this.email.url('en', `/admin/sessions/${event.id}`),
    });
    await this.notifications.notifyAdmins({
      type: 'speaker_booking',
      titleEn: 'New speaker booking',
      titleAr: 'حجز جديد من متحدث',
      bodyEn: `${app.fullName} booked ${formatWhen(slot.startsAt, 'en')}: ${input.title}`,
      bodyAr: `${app.fullName} حجز ${formatWhen(slot.startsAt, 'ar')}: ${input.title}`,
      link: `/admin/sessions/${event.id}`,
    });
    return dto;
  }

  /** One email per team address, on the bulk lane (never ahead of sign-ups and resets). */
  private async tellTeam(
    to: string[],
    t: Omit<Extract<Parameters<EmailService['send']>[2], { name: 'speakerBookingTeam' }>, 'name'>,
  ): Promise<void> {
    for (const address of to) {
      void this.email.send(address, 'en', { name: 'speakerBookingTeam', ...t }, { bulk: true }).catch(() => undefined);
    }
  }

  /**
   * Frees a booked slot in one transaction: the slot is OPEN again, and its session goes
   * with it. A DRAFT (never public) is deleted, so the speaker's text never reaches the
   * public pages; a session the team already published is CANCELLED, so registrants hear.
   */
  private async release(
    slotId: string,
    actorId: string | null,
    action: string,
    check: (locked: { bookedById: string | null; startsAt: Date }, event: LiveEvent | null) => void,
  ): Promise<{ slot: SpeakingSlot; event: LiveEvent | null; bookedById: string | null; cancelled: LiveEvent | null }> {
    return this.prisma.$transaction(async (tx) => {
      const [locked] = await tx.$queryRaw<{ status: string; bookedById: string | null; startsAt: Date; eventId: string | null }[]>`
        SELECT status::text AS status, "bookedById", "startsAt", "eventId" FROM "SpeakingSlot" WHERE id = ${slotId} FOR UPDATE`;
      if (!locked || locked.status !== 'BOOKED') throw new NotFoundException('Booking not found');
      const event = locked.eventId ? await tx.liveEvent.findUnique({ where: { id: locked.eventId } }) : null;
      check(locked, event);
      const slot = await tx.speakingSlot.update({
        where: { id: slotId },
        data: { status: 'OPEN', bookedById: null, bookedAt: null, title: null, abstract: null, eventId: null },
      });
      let cancelled: LiveEvent | null = null;
      if (event?.status === 'DRAFT') {
        await tx.liveEvent.delete({ where: { id: event.id } });
        await this.audit.log({ actorId, action: 'event.deleted', entityType: 'LiveEvent', entityId: event.id, metadata: { slug: event.slug, status: 'DRAFT', source: 'speaker-booking' } }, tx);
      } else if (event?.status === 'PUBLISHED') {
        cancelled = await tx.liveEvent.update({ where: { id: event.id }, data: { status: 'CANCELLED' } });
        await this.audit.log({ actorId, action: 'event.updated', entityType: 'LiveEvent', entityId: event.id, metadata: { slug: event.slug, status: { from: 'PUBLISHED', to: 'CANCELLED' } } }, tx);
      }
      await this.audit.log({ actorId, action, entityType: 'SpeakingSlot', entityId: slotId, metadata: { eventId: event?.id ?? null, bookedById: locked.bookedById } }, tx);
      return { slot, event, bookedById: locked.bookedById, cancelled };
    });
  }

  /** After a release: registrants of a published session, the session team and admins hear about it. */
  private async afterRelease(r: { slot: SpeakingSlot; event: LiveEvent | null; bookedById: string | null; cancelled: LiveEvent | null; title?: string | null }, speakerName?: string): Promise<void> {
    if (r.cancelled) await this.events.notifyCancelled(r.cancelled);
    const settings = await this.settings.get();
    const user = r.bookedById ? await this.prisma.user.findUnique({ where: { id: r.bookedById }, select: { email: true, speakerApplication: { select: { fullName: true } } } }) : null;
    const name = speakerName ?? user?.speakerApplication?.fullName ?? user?.email ?? 'Speaker';
    const title = r.event?.titleEn ?? r.title ?? 'Speaker session';
    await this.tellTeam(settings.sessionTeamEmails, {
      kind: 'cancelled',
      speakerName: name,
      speakerEmail: user?.email ?? '',
      title,
      abstract: '',
      when: formatWhen(r.slot.startsAt, 'en'),
      url: this.email.url('en', '/admin/speakers/availability'),
    });
    await this.notifications.notifyAdmins({
      type: 'speaker_booking_cancelled',
      titleEn: 'A speaker booking was cancelled',
      titleAr: 'أُلغي حجز متحدث',
      bodyEn: `${name}: ${title}`,
      bodyAr: `${name}: ${title}`,
      link: '/admin/speakers/availability',
    });
  }

  /** The speaker cancels until N days before: the slot opens again and the session goes. */
  async cancel(userId: string, slotId: string, now = new Date()): Promise<void> {
    const settings = await this.settings.get();
    const r = await this.release(slotId, userId, 'speaking_slot.cancelled_by_speaker', (locked, event) => {
      if (locked.bookedById !== userId) throw new NotFoundException('Booking not found');
      if (!canCancelBooking(event?.startsAt ?? locked.startsAt, settings.speakerCancelDays, now)) {
        throw new ConflictException({
          code: 'CANCEL_WINDOW_CLOSED',
          message: `Bookings can be cancelled until ${settings.speakerCancelDays} days before the session. Contact the team instead.`,
        });
      }
    });
    await this.afterRelease(r);
  }

  /** The team frees a booked slot at any time (speaker unavailable, session moved or deleted). */
  async adminRelease(slotId: string, actorId: string): Promise<void> {
    const r = await this.release(slotId, actorId, 'speaking_slot.released_by_admin', () => undefined);
    await this.afterRelease(r);
  }

  /** A calendar file for the speaker's own booking (signed in; the session may still be a draft). */
  async ics(userId: string, slotId: string, locale: Locale): Promise<{ filename: string; body: string }> {
    const s = await this.prisma.speakingSlot.findFirst({ where: { id: slotId, bookedById: userId, status: 'BOOKED' }, include: { event: true } });
    if (!s) throw new NotFoundException('Booking not found');
    const title = s.title ?? s.event?.titleEn ?? 'MLOps MENA session';
    const url = `${this.env.WEB_URL}/${locale}/speaker`;
    const body = buildIcs(title, [
      {
        uid: `speaker-slot-${s.id}`,
        title,
        description: locale === 'ar' ? `جلستك متحدثًا في أكاديمية MLOps MENA. التفاصيل: ${url}` : `Your session as a speaker at MLOps MENA Academy. Details: ${url}`,
        url,
        start: s.event?.startsAt ?? s.startsAt,
        durationMin: s.event?.durationMin ?? s.durationMin,
        updatedAt: s.updatedAt,
        cancelled: s.event?.status === 'CANCELLED',
      },
    ]);
    return { filename: `speaker-session-${s.id}.ics`, body };
  }

  // ------------------------------------------------------------------ admin: applications

  private adminInclude = {
    user: { select: { id: true, email: true, role: true, speakerProfile: { select: { id: true, slug: true, name: true } } } },
    reviewedBy: { select: { email: true } },
  } satisfies Prisma.SpeakerApplicationInclude;

  private toAdminDto(a: Prisma.SpeakerApplicationGetPayload<{ include: SpeakerPortalService['adminInclude'] }>): AdminSpeakerApplicationDto {
    return {
      ...toApplicationDto(a, a.user.email),
      userId: a.user.id,
      userRole: a.user.role,
      reviewedBy: a.reviewedBy?.email ?? null,
      instructor: a.user.speakerProfile,
    };
  }

  async adminList(f: SpeakerApplicationFilter): Promise<AdminSpeakerApplicationDto[]> {
    const q = f.q?.trim();
    const rows = await this.prisma.speakerApplication.findMany({
      where: {
        user: { deletedAt: null },
        ...(f.status ? { status: f.status } : {}),
        ...(f.area ? { areas: { has: f.area } } : {}),
        ...(q
          ? {
              OR: [
                { fullName: { contains: q, mode: 'insensitive' } },
                { sessionTitle: { contains: q, mode: 'insensitive' } },
                { company: { contains: q, mode: 'insensitive' } },
                { user: { email: { contains: q, mode: 'insensitive' } } },
              ],
            }
          : {}),
      },
      // Waiting ones first, oldest first: that's the review queue.
      orderBy: [{ status: 'asc' }, { submittedAt: 'asc' }],
      take: 500,
      include: this.adminInclude,
    });
    return rows.map((a) => this.toAdminDto(a));
  }

  async adminGet(id: string): Promise<AdminSpeakerApplicationDto> {
    const a = await this.prisma.speakerApplication.findUnique({ where: { id }, include: this.adminInclude });
    if (!a) throw new NotFoundException('Application not found');
    return this.toAdminDto(a);
  }

  /**
   * Approves (creating or linking the public speaker profile) or rejects with a note. The
   * speaker is emailed either way.
   */
  async review(id: string, input: SpeakerReviewInput, actorId: string): Promise<AdminSpeakerApplicationDto> {
    const app = await this.prisma.speakerApplication.findUnique({
      where: { id },
      include: { user: { select: { id: true, email: true, locale: true, role: true, deletedAt: true, speakerProfile: { select: { id: true } } } } },
    });
    if (!app || app.user.deletedAt) throw new NotFoundException('Application not found');
    if (app.status !== 'SUBMITTED') {
      throw new ConflictException({ code: 'ALREADY_REVIEWED', message: 'This application was already reviewed' });
    }
    if (input.decision === 'APPROVE' && app.user.role !== 'SPEAKER') {
      throw new ConflictException({ code: 'NOT_A_SPEAKER_ACCOUNT', message: 'Switch this account to a speaker account first' });
    }
    const status = input.decision === 'APPROVE' ? 'APPROVED' : 'REJECTED';
    let instructorId: string | null = null;
    try {
      await this.prisma.$transaction(async (tx) => {
        const claimed = await tx.speakerApplication.updateMany({
          where: { id, status: 'SUBMITTED' },
          data: { status, reviewNote: input.note || null, reviewedById: actorId, reviewedAt: new Date() },
        });
        if (claimed.count !== 1) throw new ConflictException({ code: 'ALREADY_REVIEWED', message: 'This application was already reviewed' });
        if (status === 'APPROVED') {
          if (app.user.speakerProfile) {
            instructorId = app.user.speakerProfile.id;
          } else if (input.instructorId) {
            // Link an existing profile (e.g. a speaker from the archive): it keeps its own page and history.
            const linked = await tx.instructor.updateMany({ where: { id: input.instructorId, userId: null }, data: { userId: app.userId } });
            if (linked.count !== 1) throw new BadRequestException({ code: 'INSTRUCTOR_UNAVAILABLE', message: 'That speaker profile does not exist or belongs to another account' });
            instructorId = input.instructorId;
          } else {
            const created = await tx.instructor.create({
              data: {
                slug: await freeInstructorSlug(tx, app.fullName),
                name: app.fullName,
                titleEn: app.company ? `${app.title}, ${app.company}` : app.title,
                bioEn: app.bio,
                photoUrl: app.photoUrl,
                linkedinUrl: app.linkedinUrl,
                source: 'speaker-portal',
                userId: app.userId,
              },
            });
            instructorId = created.id;
            await this.audit.log({ actorId, action: 'instructor.created', entityType: 'Instructor', entityId: created.id, metadata: { from: 'speaker_application' } }, tx);
          }
        }
        await this.audit.log(
          { actorId, action: status === 'APPROVED' ? 'speaker_application.approved' : 'speaker_application.rejected', entityType: 'SpeakerApplication', entityId: id, metadata: { instructorId } },
          tx,
        );
      });
    } catch (err) {
      if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') {
        throw new ConflictException({ code: 'INSTRUCTOR_UNAVAILABLE', message: 'That speaker profile belongs to another account' });
      }
      throw err;
    }
    const locale: Locale = app.user.locale === 'ar' ? 'ar' : 'en';
    void this.email
      .send(app.user.email, locale, { name: 'speakerReviewed', decision: status, note: input.note || null, url: this.email.url(locale, '/speaker') })
      .catch(() => undefined);
    await this.notifications.create(app.userId, {
      type: 'speaker_application_reviewed',
      titleEn: status === 'APPROVED' ? 'You are approved to speak' : 'About your speaker application',
      titleAr: status === 'APPROVED' ? 'تمت الموافقة على طلبك للتحدث' : 'بخصوص طلبك للتحدث',
      bodyEn: status === 'APPROVED' ? 'Pick an open slot and book your session.' : input.note,
      bodyAr: status === 'APPROVED' ? 'اختر موعدًا متاحًا واحجز جلستك.' : input.note,
      link: '/speaker',
    });
    return this.adminGet(id);
  }

  /** One account, one role: switch between student and speaker (never to or from admin). */
  async setRole(userId: string, role: 'STUDENT' | 'SPEAKER', actorId: string): Promise<{ id: string; role: string }> {
    const user = await this.prisma.user.findUnique({ where: { id: userId }, select: { role: true, deletedAt: true } });
    if (!user || user.deletedAt) throw new NotFoundException('User not found');
    if (user.role === 'ADMIN') throw new ForbiddenException({ code: 'ADMIN_ROLE', message: "An admin account's role can't be changed here" });
    if (user.role === role) return { id: userId, role };
    if (role === 'SPEAKER') {
      // Their course applications and enrolments live on the student dashboard, which speakers don't see.
      const [applications, enrollments] = await Promise.all([
        this.prisma.application.count({ where: { userId, status: { not: 'REJECTED' } } }),
        this.prisma.enrollment.count({ where: { userId } }),
      ]);
      if (applications || enrollments) {
        throw new ConflictException({ code: 'HAS_COURSES', message: 'This student has course applications or enrolments. Keep them a student, or ask them to sign up as a speaker with another email.' });
      }
    }
    if (role === 'STUDENT') {
      const upcoming = await this.prisma.speakingSlot.count({ where: { bookedById: userId, status: 'BOOKED', startsAt: { gt: new Date() } } });
      if (upcoming) throw new ConflictException({ code: 'HAS_BOOKINGS', message: 'This speaker has upcoming bookings. Release them in Availability first.' });
    }
    await this.prisma.user.update({ where: { id: userId }, data: { role } });
    await this.audit.log({ actorId, action: 'user.role_changed', entityType: 'User', entityId: userId, metadata: { from: user.role, to: role } });
    return { id: userId, role };
  }

  // ------------------------------------------------------------------ admin: availability

  async adminSlots(from: Date, to: Date): Promise<AdminSlotDto[]> {
    const rows = await this.prisma.speakingSlot.findMany({
      where: { startsAt: { gte: from, lt: to } },
      orderBy: { startsAt: 'asc' },
      take: 1000,
      include: {
        bookedBy: { select: { id: true, email: true, speakerApplication: { select: { fullName: true } } } },
        event: { select: { id: true, slug: true, status: true } },
      },
    });
    return rows.map((s) => ({
      id: s.id,
      startsAt: s.startsAt.toISOString(),
      durationMin: s.durationMin,
      status: s.status,
      title: s.title,
      bookedBy: s.bookedBy ? { id: s.bookedBy.id, email: s.bookedBy.email, name: s.bookedBy.speakerApplication?.fullName ?? s.bookedBy.email } : null,
      event: s.event,
    }));
  }

  /** Times that already have a slot (open or booked): the generator never doubles them. */
  private async taken(times: Date[]): Promise<Set<number>> {
    if (!times.length) return new Set();
    const rows = await this.prisma.speakingSlot.findMany({
      where: { startsAt: { in: times }, status: { not: 'CANCELLED' } },
      select: { startsAt: true },
    });
    return new Set(rows.map((r) => r.startsAt.getTime()));
  }

  async addSlot(input: SlotInput, actorId: string, now = new Date()): Promise<AdminSlotDto> {
    if (input.startsAt.getTime() <= now.getTime()) throw new BadRequestException({ code: 'SLOT_IN_PAST', message: 'Choose a time in the future' });
    if ((await this.taken([input.startsAt])).size) throw new ConflictException({ code: 'SLOT_EXISTS', message: 'There is already a slot at this time' });
    const s = await this.prisma.speakingSlot.create({ data: { startsAt: input.startsAt, durationMin: input.durationMin, createdById: actorId } });
    await this.audit.log({ actorId, action: 'speaking_slot.created', entityType: 'SpeakingSlot', entityId: s.id });
    return { id: s.id, startsAt: s.startsAt.toISOString(), durationMin: s.durationMin, status: s.status, title: null, bookedBy: null, event: null };
  }

  async generate(input: SlotGeneratorInput, actorId: string, now = new Date()): Promise<{ created: number; skipped: number }> {
    const times = generateSlotTimes(input, now);
    if (times.length > MAX_GENERATED_SLOTS) {
      throw new BadRequestException({ code: 'TOO_MANY_SLOTS', message: `That makes ${times.length} slots; generate at most ${MAX_GENERATED_SLOTS} at once` });
    }
    const taken = await this.taken(times);
    const fresh = times.filter((t) => !taken.has(t.getTime()));
    if (fresh.length) {
      await this.prisma.speakingSlot.createMany({ data: fresh.map((startsAt) => ({ startsAt, durationMin: input.durationMin, createdById: actorId })) });
    }
    await this.audit.log({
      actorId,
      action: 'speaking_slot.generated',
      entityType: 'SpeakingSlot',
      metadata: { created: fresh.length, skipped: times.length - fresh.length, weekdays: input.weekdays, time: input.time, months: input.months },
    });
    return { created: fresh.length, skipped: times.length - fresh.length };
  }

  /** Withdraws an OPEN slot (kept, marked CANCELLED); a booked one must be cancelled by the speaker or handled in the session. */
  async cancelSlot(id: string, actorId: string): Promise<void> {
    const r = await this.prisma.speakingSlot.updateMany({ where: { id, status: 'OPEN' }, data: { status: 'CANCELLED' } });
    if (r.count !== 1) throw new ConflictException({ code: 'SLOT_NOT_OPEN', message: 'Only open slots can be withdrawn' });
    await this.audit.log({ actorId, action: 'speaking_slot.withdrawn', entityType: 'SpeakingSlot', entityId: id });
  }

  async deleteSlot(id: string, actorId: string): Promise<void> {
    const r = await this.prisma.speakingSlot.deleteMany({ where: { id, status: { in: ['OPEN', 'CANCELLED'] } } });
    if (r.count !== 1) throw new ConflictException({ code: 'SLOT_NOT_OPEN', message: 'Only open or withdrawn slots can be deleted' });
    await this.audit.log({ actorId, action: 'speaking_slot.deleted', entityType: 'SpeakingSlot', entityId: id });
  }

  // ------------------------------------------------------------------ account deletion

  /**
   * On account deletion: upcoming bookings are released (slot open again, draft session
   * cancelled) and the team is told. Past bookings stay with the session history.
   */
  async releaseBookings(user: Pick<User, 'id' | 'email'>, now = new Date()): Promise<number> {
    const slots = await this.prisma.speakingSlot.findMany({ where: { bookedById: user.id, status: 'BOOKED', startsAt: { gt: now } }, select: { id: true, title: true } });
    let released = 0;
    for (const s of slots) {
      // One booking failing must not stop the account deletion or the other releases.
      try {
        const r = await this.release(s.id, user.id, 'speaking_slot.released_account_deleted', () => undefined);
        await this.afterRelease({ ...r, title: s.title }, '(deleted account)');
        released++;
      } catch (err) {
        this.logger.error(`Could not release a speaker booking of a deleted account: ${(err as Error).message}`);
      }
    }
    if (released) this.logger.log(`Released ${released} speaker booking(s) of a deleted account`);
    return released;
  }
}
