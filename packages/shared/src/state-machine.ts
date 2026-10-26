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
 *
 *   WITHDRAW: the student (or the deletion of their account) ─▶ WITHDRAWN, from any status before
 *   ENROLLED except REJECTED. The seat is freed; applying again reopens the same application.
 *
 *   ADMIN_ENROL ("Enrol by email"): any status except ENROLLED ─▶ ENROLLED, with no payment and
 *   regardless of capacity. Only the invites service sends it, never the applications table.
 *
 *   CARD_PAID: a verified card payment (Paymob webhook), AWAITING_PAYMENT or PAYMENT_REJECTED
 *   ─▶ ENROLLED. The gateway confirmed the money, so there is no review step.
 */

export const APPLICATION_EVENTS = [
  'SHORTLIST',
  'ACCEPT',
  'REJECT',
  'WAITLIST',
  'SUBMIT_PAYMENT',
  'APPROVE_PAYMENT',
  'REJECT_PAYMENT',
  'CARD_PAID',
  'ADMIN_ENROL',
  'WITHDRAW',
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
  ApplicationStatus.WITHDRAWN,
];

/**
 * Statuses a student may withdraw from themselves. Not while a payment is under review (money
 * was sent: the team settles it, refund included), and never once enrolled (see the refund policy).
 */
export const SELF_WITHDRAWABLE_STATUSES: readonly ApplicationStatus[] = [
  ApplicationStatus.SUBMITTED,
  ApplicationStatus.SHORTLISTED,
  ApplicationStatus.WAITLISTED,
  ApplicationStatus.AWAITING_PAYMENT,
  ApplicationStatus.PAYMENT_REJECTED,
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
  const result = nextStatus(current, event, ctx);
  // A transition that lands where it started (e.g. promoting from a full waitlist) changed
  // nothing; treat it as a failure so callers never write history or send emails for it.
  if (result.ok && result.status === current) return fail('Course is full');
  return result;
}

function nextStatus(
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

    case 'CARD_PAID':
      if (ctx.courseType !== CourseType.PAID) return fail('Course is free; no payment expected');
      if (current === S.AWAITING_PAYMENT || current === S.PAYMENT_REJECTED) return to(S.ENROLLED);
      break;

    case 'WITHDRAW':
      // Anything still open. PAYMENT_SUBMITTED only through account deletion (see SELF_WITHDRAWABLE_STATUSES).
      if (current !== S.ENROLLED && current !== S.REJECTED && current !== S.WITHDRAWN) return to(S.WITHDRAWN);
      break;

    case 'ADMIN_ENROL':
      // The admin decided: no payment step and no capacity check (the preview warns about capacity).
      if (current !== S.ENROLLED) return to(S.ENROLLED);
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
  return ADMIN_APPLICATION_EVENTS.filter((e) => transition(current, e, ctx).ok);
}
