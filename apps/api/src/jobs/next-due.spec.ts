import { earliestAfter, NextDue, nextPrompt, OUTBOX_RETRY_MS } from './next-due';

const MIN = 60_000;
const HOUR = 60 * MIN;
const now = new Date('2026-11-20T10:00:00Z');
const at = (ms: number) => new Date(now.getTime() + ms);

/** A Prisma stand-in: each model's findFirst answers by the `gt` it is asked for, like an ordered query. */
function prisma(rows: {
  sessions?: { startsAt: Date; durationMin: number }[];
  live?: Date[];
  calls?: Date[];
  assessments?: Date[];
  pending?: Date[];
  sending?: Date[];
}) {
  const first = (dates: Date[] = [], after?: Date) => [...dates].sort((a, b) => +a - +b).find((d) => !after || d > after) ?? null;
  return {
    courseSession: {
      findFirst: jest.fn(async ({ where }) => {
        const d = first((rows.sessions ?? []).map((s) => s.startsAt), where.startsAt.gt);
        return d ? { startsAt: d } : null;
      }),
      findMany: jest.fn(async ({ where }) => (rows.sessions ?? []).filter((s) => s.startsAt > where.startsAt.gt).sort((a, b) => +a.startsAt - +b.startsAt)),
    },
    liveEvent: { findFirst: jest.fn(async ({ where }) => ((d) => (d ? { startsAt: d } : null))(first(rows.live, where.startsAt.gt))) },
    consultationBooking: { findFirst: jest.fn(async ({ where }) => ((d) => (d ? { startsAt: d } : null))(first(rows.calls, where.startsAt.gt))) },
    assessment: { findFirst: jest.fn(async ({ where }) => ((d) => (d ? { dueAt: d } : null))(first(rows.assessments, where.dueAt.gt))) },
    outboundEmail: {
      findFirst: jest.fn(async ({ where }) => {
        if (where.status === 'PENDING') return ((d) => (d ? { notBefore: d } : null))(first(rows.pending));
        return ((d) => (d ? { leaseUntil: d } : null))(first(rows.sending));
      }),
    },
  };
}
const nextDue = (rows: Parameters<typeof prisma>[0]) => new NextDue(prisma(rows) as never).at(now);

describe('NextDue', () => {
  it('is null when nothing is scheduled', async () => {
    expect(await nextDue({})).toBeNull();
  });

  it('a session tomorrow: its 24-hour window opens first', async () => {
    expect(await nextDue({ sessions: [{ startsAt: at(30 * HOUR), durationMin: 90 }] })).toEqual(at(6 * HOUR));
  });

  it('a session in 2 hours: past its 24-hour window, so the 1-hour window (75 minutes before)', async () => {
    expect(await nextDue({ sessions: [{ startsAt: at(2 * HOUR), durationMin: 60 }] })).toEqual(at(2 * HOUR - 75 * MIN));
  });

  it('a session whose window is open now was handled by this tick: its feedback prompt is next', async () => {
    // Starts in 30 minutes (inside the 1-hour window), lasts an hour: prompt 30 minutes after it ends.
    expect(await nextDue({ sessions: [{ startsAt: at(30 * MIN), durationMin: 60 }] })).toEqual(at(2 * HOUR));
  });

  it('live sessions, calls and assessment deadlines count too', async () => {
    expect(await nextDue({ live: [at(3 * HOUR)] })).toEqual(at(3 * HOUR - 75 * MIN));
    expect(await nextDue({ calls: [at(25 * HOUR)] })).toEqual(at(HOUR));
    expect(await nextDue({ assessments: [at(26 * HOUR)] })).toEqual(at(2 * HOUR));
  });

  it('emails: a later retry at its time, one due now soon, a dead lease soon', async () => {
    expect(await nextDue({ pending: [at(40 * MIN)] })).toEqual(at(40 * MIN));
    expect(await nextDue({ pending: [at(-5 * MIN)] })).toEqual(at(OUTBOX_RETRY_MS));
    expect(await nextDue({ sending: [at(-1 * MIN)] })).toEqual(at(OUTBOX_RETRY_MS));
  });

  it('takes the earliest of everything', async () => {
    expect(await nextDue({ sessions: [{ startsAt: at(30 * HOUR), durationMin: 90 }], live: [at(3 * HOUR)], pending: [at(20 * MIN)] })).toEqual(at(20 * MIN));
  });
});

describe('helpers', () => {
  it('earliestAfter ignores the past, now itself and nulls', () => {
    expect(earliestAfter([null, at(-1), now, at(5), at(3)], now)).toEqual(at(3));
    expect(earliestAfter([null, now], now)).toBeNull();
  });
  it('nextPrompt is 30 minutes after a session ends, never in the past', () => {
    expect(nextPrompt([{ startsAt: at(-2 * HOUR), durationMin: 60 }], now)).toBeNull();
    expect(nextPrompt([{ startsAt: at(-45 * MIN), durationMin: 60 }], now)).toEqual(at(45 * MIN));
  });
});
