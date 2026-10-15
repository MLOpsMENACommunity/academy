import { describe, expect, it } from 'vitest';
import { ApplicationStatus as S } from './enums';
import {
  availableAdminEvents,
  initialStatus,
  transition,
  type TransitionContext,
} from './state-machine';

const paid: TransitionContext = { courseType: 'PAID', seatsTaken: 0, capacity: null };
const free: TransitionContext = { courseType: 'FREE', seatsTaken: 0, capacity: null };
const full = (ctx: TransitionContext): TransitionContext => ({ ...ctx, capacity: 10, seatsTaken: 10 });

const ok = (status: S) => ({ ok: true, status });

describe('initialStatus', () => {
  it('starts at SUBMITTED when approval is required', () => {
    expect(initialStatus(true, free)).toBe(S.SUBMITTED);
    expect(initialStatus(true, full(paid))).toBe(S.SUBMITTED);
  });
  it('enrols free courses instantly when no approval is needed', () => {
    expect(initialStatus(false, free)).toBe(S.ENROLLED);
  });
  it('sends paid courses straight to payment when no approval is needed', () => {
    expect(initialStatus(false, paid)).toBe(S.AWAITING_PAYMENT);
  });
  it('waitlists when capacity is full', () => {
    expect(initialStatus(false, full(free))).toBe(S.WAITLISTED);
  });
});

describe('transition', () => {
  it('runs the full paid happy path', () => {
    expect(transition(S.SUBMITTED, 'SHORTLIST', paid)).toEqual(ok(S.SHORTLISTED));
    expect(transition(S.SHORTLISTED, 'ACCEPT', paid)).toEqual(ok(S.AWAITING_PAYMENT));
    expect(transition(S.AWAITING_PAYMENT, 'SUBMIT_PAYMENT', paid)).toEqual(ok(S.PAYMENT_SUBMITTED));
    expect(transition(S.PAYMENT_SUBMITTED, 'APPROVE_PAYMENT', paid)).toEqual(ok(S.ENROLLED));
  });

  it('enrols free courses on accept', () => {
    expect(transition(S.SHORTLISTED, 'ACCEPT', free)).toEqual(ok(S.ENROLLED));
    expect(transition(S.SUBMITTED, 'ACCEPT', free)).toEqual(ok(S.ENROLLED));
  });

  it('lets a student resubmit after a rejected payment', () => {
    expect(transition(S.PAYMENT_SUBMITTED, 'REJECT_PAYMENT', paid)).toEqual(ok(S.PAYMENT_REJECTED));
    expect(transition(S.PAYMENT_REJECTED, 'SUBMIT_PAYMENT', paid)).toEqual(ok(S.PAYMENT_SUBMITTED));
  });

  it('waitlists on shortlist when capacity is full', () => {
    expect(transition(S.SUBMITTED, 'SHORTLIST', full(paid))).toEqual(ok(S.WAITLISTED));
  });

  it('waitlists on accept from SUBMITTED when full, but not from SHORTLISTED (seat already held)', () => {
    expect(transition(S.SUBMITTED, 'ACCEPT', full(free))).toEqual(ok(S.WAITLISTED));
    expect(transition(S.SHORTLISTED, 'ACCEPT', full(free))).toEqual(ok(S.ENROLLED));
  });

  it('fails instead of no-op when promoting from a full waitlist', () => {
    expect(transition(S.WAITLISTED, 'SHORTLIST', full(paid))).toEqual({ ok: false, error: 'Course is full' });
    expect(transition(S.WAITLISTED, 'ACCEPT', full(paid))).toEqual({ ok: false, error: 'Course is full' });
  });

  it('promotes from the waitlist once a seat frees up', () => {
    expect(transition(S.WAITLISTED, 'ACCEPT', paid)).toEqual(ok(S.AWAITING_PAYMENT));
  });

  it('rejects from screening states with REJECT', () => {
    for (const s of [S.SUBMITTED, S.SHORTLISTED, S.WAITLISTED]) {
      expect(transition(s, 'REJECT', paid)).toEqual(ok(S.REJECTED));
    }
  });

  it('refuses invalid transitions', () => {
    expect(transition(S.ENROLLED, 'REJECT', paid).ok).toBe(false);
    expect(transition(S.REJECTED, 'SHORTLIST', paid).ok).toBe(false);
    expect(transition(S.SUBMITTED, 'APPROVE_PAYMENT', paid).ok).toBe(false);
    expect(transition(S.SUBMITTED, 'SUBMIT_PAYMENT', paid).ok).toBe(false);
    expect(transition(S.PAYMENT_SUBMITTED, 'SUBMIT_PAYMENT', paid).ok).toBe(false);
    expect(transition(S.AWAITING_PAYMENT, 'SUBMIT_PAYMENT', free).ok).toBe(false);
  });

  it('never lets an enrolled application change', () => {
    for (const e of ['SHORTLIST', 'ACCEPT', 'REJECT', 'WAITLIST', 'SUBMIT_PAYMENT', 'APPROVE_PAYMENT', 'REJECT_PAYMENT', 'ADMIN_ENROL'] as const) {
      expect(transition(S.ENROLLED, e, paid).ok).toBe(false);
    }
  });

  it('enrols directly from any other status with ADMIN_ENROL, without payment and even when full', () => {
    for (const s of [S.SUBMITTED, S.SHORTLISTED, S.WAITLISTED, S.REJECTED, S.AWAITING_PAYMENT, S.PAYMENT_SUBMITTED, S.PAYMENT_REJECTED]) {
      expect(transition(s, 'ADMIN_ENROL', full(paid))).toEqual(ok(S.ENROLLED));
    }
  });
});

describe('availableAdminEvents', () => {
  it('lists the actions an admin can take', () => {
    expect(availableAdminEvents(S.SUBMITTED, paid)).toEqual(['SHORTLIST', 'ACCEPT', 'REJECT', 'WAITLIST']);
    expect(availableAdminEvents(S.PAYMENT_SUBMITTED, paid)).toEqual([]);
    expect(availableAdminEvents(S.WAITLISTED, paid)).toEqual(['SHORTLIST', 'ACCEPT', 'REJECT']);
  });
});

describe('WITHDRAW', () => {
  it('withdraws anything still open, from any status before enrolment except a rejection', () => {
    for (const from of [S.SUBMITTED, S.SHORTLISTED, S.WAITLISTED, S.AWAITING_PAYMENT, S.PAYMENT_SUBMITTED, S.PAYMENT_REJECTED]) {
      expect(transition(from, 'WITHDRAW', paid)).toEqual(ok(S.WITHDRAWN));
    }
    for (const from of [S.ENROLLED, S.REJECTED, S.WITHDRAWN]) expect(transition(from, 'WITHDRAW', paid).ok).toBe(false);
  });
  it('is never offered to admins as an action', () => {
    expect(availableAdminEvents(S.SUBMITTED, free)).not.toContain('WITHDRAW');
    expect(availableAdminEvents(S.WITHDRAWN, free)).toEqual([]);
  });
  it('lets the team enrol a withdrawn student by email', () => {
    expect(transition(S.WITHDRAWN, 'ADMIN_ENROL', paid)).toEqual(ok(S.ENROLLED));
  });
});
