import { ApplicationStatus, CourseType } from './enums';

/**
 * Application lifecycle as an explicit state machine. Every status change in
 * the API goes through `transition()`; nothing else writes `Application.status`.
 *
 *   SUBMITTED ─┬─ SHORTLIST ─▶ SHORTLISTED ─ ACCEPT ─┬─(paid)─▶ AWAITING_PAYMENT ─ SUBMIT_PAYMENT ─▶ PAYMENT_SUBMITTED
 *              │                                     └─(free)─▶ ENROLLED                              │
 *              ├─ REJECT ─▶ REJECTED                                         APPROVE_PAYMENT ◀────────┤
 *              └─ WAITLIST ─▶ WAITLISTED  (also automatic when capacity is full)   REJECT_PAYMENT ─▶ PAYMENT_REJECTED
 *                                                                                  (student resubmits ─▶ PAYMENT_SUBMITTED)
 */

export const APPLICATION_EVENTS = [
  'SHORTLIST',
  'ACCEPT',
  'REJECT',
  'WAITLIST',
  'SUBMIT_PAYMENT',
  'APPROVE_PAYMENT',
  'REJECT_PAYMENT',
] as const;
export type ApplicationEvent = (typeof APPLICATION_EVENTS)[number];

/** Events an admin can trigger from the applications table (bulk or single). */
export const ADMIN_APPLICATION_EVENTS = ['SHORTLIST', 'ACCEPT', 'REJECT', 'WAITLIST'] as const;
export type AdminApplicationEvent = (typeof ADMIN_APPLICATION_EVENTS)[number];

/** Statuses that hold a seat against `Course.capacity`. */
export const SEAT_HOLDING_STATUSES: readonly ApplicationStatus[] = [
  ApplicationStatus.SHORTLISTED,
  ApplicationStatus.AWAITING_PAYMENT,
  ApplicationStatus.PAYMENT_SUBMITTED,
  ApplicationStatus.PAYMENT_REJECTED,
  ApplicationStatus.ENROLLED,
];

export const TERMINAL_STATUSES: readonly ApplicationStatus[] = [
  ApplicationStatus.ENROLLED,
  ApplicationStatus.REJECTED,
];

export interface TransitionContext {
  courseType: CourseType;
  /** Seats already held by *other* applications. */
  seatsTaken: number;
  /** `null` means unlimited. */
  capacity: number | null;
}

export type TransitionResult =
  | { ok: true; status: ApplicationStatus }
  | { ok: false; error: string };

const fail = (error: string): TransitionResult => ({ ok: false, error });
const to = (status: ApplicationStatus): TransitionResult => ({ ok: true, status });

function isFull(ctx: TransitionContext): boolean {
  return ctx.capacity !== null && ctx.seatsTaken >= ctx.capacity;
}

/** Where an accepted application lands: payment for paid courses, enrolment for free ones. */
function acceptTarget(ctx: TransitionContext): ApplicationStatus {
  return ctx.courseType === CourseType.PAID
    ? ApplicationStatus.AWAITING_PAYMENT
    : ApplicationStatus.ENROLLED;
}

export function transition(
  current: ApplicationStatus,
  event: ApplicationEvent,
  ctx: TransitionContext,
): TransitionResult {
  const S = ApplicationStatus;
  switch (event) {
    case 'SHORTLIST':
      if (current !== S.SUBMITTED && current !== S.WAITLISTED) break;
      return to(isFull(ctx) ? S.WAITLISTED : S.SHORTLISTED);

    case 'ACCEPT':
      if (current !== S.SUBMITTED && current !== S.SHORTLISTED && current !== S.WAITLISTED) break;
      // A shortlisted application already holds its seat, so it can always be accepted.
      if (current !== S.SHORTLISTED && isFull(ctx)) return to(S.WAITLISTED);
      return to(acceptTarget(ctx));

    case 'REJECT':
      if (
        current === S.SUBMITTED ||
        current === S.SHORTLISTED ||
        current === S.WAITLISTED ||
        current === S.AWAITING_PAYMENT ||
        current === S.PAYMENT_REJECTED
      ) {
        return to(S.REJECTED);
      }
      break;

    case 'WAITLIST':
      if (current === S.SUBMITTED || current === S.SHORTLISTED) return to(S.WAITLISTED);
      break;

    case 'SUBMIT_PAYMENT':
      if (ctx.courseType !== CourseType.PAID) return fail('Course is free; no payment expected');
      if (current === S.AWAITING_PAYMENT || current === S.PAYMENT_REJECTED) {
        return to(S.PAYMENT_SUBMITTED);
      }
      break;

    case 'APPROVE_PAYMENT':
      if (current === S.PAYMENT_SUBMITTED) return to(S.ENROLLED);
      break;

    case 'REJECT_PAYMENT':
      if (current === S.PAYMENT_SUBMITTED) return to(S.PAYMENT_REJECTED);
      break;
  }
  return fail(`Cannot ${event} an application in status ${current}`);
}

/**
 * Status for a brand-new application. Courses that require approval start at
 * SUBMITTED; otherwise the application is accepted immediately (free courses
 * enrol instantly, paid ones go straight to payment) unless capacity is full.
 */
export function initialStatus(requiresApproval: boolean, ctx: TransitionContext): ApplicationStatus {
  if (requiresApproval) return ApplicationStatus.SUBMITTED;
  if (isFull(ctx)) return ApplicationStatus.WAITLISTED;
  return acceptTarget(ctx);
}

/** Admin events that are valid for an application, for rendering action buttons. */
export function availableAdminEvents(
  current: ApplicationStatus,
  ctx: TransitionContext,
): AdminApplicationEvent[] {
  return ADMIN_APPLICATION_EVENTS.filter((e) => {
    const r = transition(current, e, ctx);
    return r.ok && r.status !== current;
  });
}
