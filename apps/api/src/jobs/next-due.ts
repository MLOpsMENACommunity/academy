import { Injectable } from '@nestjs/common';
import { WINDOW as ASSESSMENT_WINDOW } from '../assessments/assessment-reminders.jobs';
import { MAX_SESSION_MS, PROMPT_AFTER_MS } from '../learn/feedback-prompts.jobs';
import { PrismaService } from '../prisma/prisma.service';
import { planStartDate, planTimezone } from '../study-plan/study-items';
import { nextReminderAfter } from '../study-plan/study-plan.jobs';
import { WINDOWS } from './reminders.jobs';

const MINUTE = 60_000;
/** An email still waiting to be sent (or retried) after this tick: try again this soon. */
export const OUTBOX_RETRY_MS = 15 * MINUTE;
/** How many upcoming sessions are enough to find the next feedback prompt (they are sorted by start). */
const FEEDBACK_LOOKAHEAD = 50;

/**
 * When the next jobs tick will have time-critical work: the earliest moment after `now` at which
 * a reminder window opens, a feedback prompt falls due, or an email waits to be (re)sent. The
 * tick returns it as `nextDueAt`, and the Cloudflare Worker wakes the API (and the database) only
 * then, or when the API is awake anyway, instead of every hour (deploy/cloudflare/src/jobs.ts).
 *
 * Everything else the tick does (retention, anonymisation, automation rules, Drive sharing,
 * points) can wait a few hours: the Worker runs it at least every MAX_GAP regardless.
 *
 * The windows are the jobs' own: course and live-session reminders and consultation calls
 * (24 hours and 1 hour before: WINDOWS, also used by event-reminders.jobs.ts and
 * ConsultationsService.queueReminders), assessment deadlines (24 hours before), feedback
 * prompts (30 minutes after a session ends) and study-plan reminders (the student's chosen hour). A window opens `to` minutes before the start, and
 * the tick reaching it any time before `from` still sends, so a tick within 15 minutes of the
 * opening is on time.
 */
@Injectable()
export class NextDue {
  constructor(private readonly prisma: PrismaService) {}

  /** The earliest due moment strictly after `now`, or null when nothing is scheduled. */
  async at(now = new Date()): Promise<Date | null> {
    const t = now.getTime();
    const candidates: (Date | null)[] = [];

    for (const leadMin of [WINDOWS.H24.to, WINDOWS.H1.to]) {
      const after = new Date(t + leadMin * MINUTE);
      const lead = (d: { startsAt: Date | null } | null) => (d?.startsAt ? new Date(d.startsAt.getTime() - leadMin * MINUTE) : null);
      const [session, live, call] = await Promise.all([
        this.prisma.courseSession.findFirst({
          where: { startsAt: { gt: after }, course: { status: { in: ['OPEN', 'CLOSED'] } } },
          orderBy: { startsAt: 'asc' },
          select: { startsAt: true },
        }),
        this.prisma.liveEvent.findFirst({ where: { status: 'PUBLISHED', startsAt: { gt: after } }, orderBy: { startsAt: 'asc' }, select: { startsAt: true } }),
        this.prisma.consultationBooking.findFirst({ where: { status: 'CONFIRMED', startsAt: { gt: after } }, orderBy: { startsAt: 'asc' }, select: { startsAt: true } }),
      ]);
      candidates.push(lead(session), lead(live), lead(call));
    }

    const assessment = await this.prisma.assessment.findFirst({
      where: { status: 'PUBLISHED', dueAt: { gt: new Date(t + ASSESSMENT_WINDOW.to * MINUTE) }, course: { status: { in: ['OPEN', 'CLOSED'] } } },
      orderBy: { dueAt: 'asc' },
      select: { dueAt: true },
    });
    candidates.push(assessment?.dueAt ? new Date(assessment.dueAt.getTime() - ASSESSMENT_WINDOW.to * MINUTE) : null);

    // A prompt falls due 30 minutes after a session ends; a session ends at most MAX_SESSION_MS after it starts.
    const ending = await this.prisma.courseSession.findMany({
      where: { startsAt: { gt: new Date(t - MAX_SESSION_MS - PROMPT_AFTER_MS) }, course: { status: { in: ['OPEN', 'CLOSED', 'COMPLETED'] } } },
      orderBy: { startsAt: 'asc' },
      select: { startsAt: true, durationMin: true },
      take: FEEDBACK_LOOKAHEAD,
    });
    candidates.push(nextPrompt(ending, now));

    const [pending, sending] = await Promise.all([
      this.prisma.outboundEmail.findFirst({ where: { status: 'PENDING' }, orderBy: { notBefore: 'asc' }, select: { notBefore: true } }),
      this.prisma.outboundEmail.findFirst({ where: { status: 'SENDING', leaseUntil: { not: null } }, orderBy: { leaseUntil: 'asc' }, select: { leaseUntil: true } }),
    ]);
    // Due now means this tick's own drain is on it: look again soon in case it stops half-way.
    if (pending) candidates.push(pending.notBefore.getTime() > t ? pending.notBefore : new Date(t + OUTBOX_RETRY_MS));
    // A run that died mid-batch leaves rows SENDING until their lease ends: the next tick takes them back.
    if (sending?.leaseUntil) candidates.push(sending.leaseUntil.getTime() > t ? sending.leaseUntil : new Date(t + OUTBOX_RETRY_MS));

    // Study-day reminders (self-paced study plans): sent only within a few hours of the student's
    // chosen time, so the Worker must wake the API for them rather than wait for MAX_GAP.
    const plans = await this.prisma.studyPlan.findMany({
      where: { reminderHour: { not: null }, user: { deletedAt: null, anonymizedAt: null }, course: { selfPaced: true, status: { in: ['OPEN', 'CLOSED'] } } },
      select: { weekdays: true, reminderHour: true, startDate: true, user: { select: { profile: { select: { timezone: true } } } } },
    });
    for (const p of plans) {
      candidates.push(nextReminderAfter({ weekdays: p.weekdays, reminderHour: p.reminderHour!, startDate: planStartDate(p) }, planTimezone(p.user.profile?.timezone), now));
    }

    return earliestAfter(candidates, now);
  }
}

/** The earliest feedback prompt after `now`, from sessions sorted by start. */
export function nextPrompt(sessions: { startsAt: Date; durationMin: number }[], now: Date): Date | null {
  const due = sessions.map((s) => s.startsAt.getTime() + s.durationMin * MINUTE + PROMPT_AFTER_MS).filter((d) => d > now.getTime());
  return due.length ? new Date(Math.min(...due)) : null;
}

/** The earliest of the candidates strictly after `now`, or null. */
export function earliestAfter(candidates: (Date | null)[], now: Date): Date | null {
  const later = candidates.filter((d): d is Date => d !== null && d.getTime() > now.getTime());
  return later.length ? new Date(Math.min(...later.map((d) => d.getTime()))) : null;
}
