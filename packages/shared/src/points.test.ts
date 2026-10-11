import { describe, expect, it } from 'vitest';
import {
  assessmentPoints,
  badgeScopeKey,
  boardName,
  courseEndsAt,
  courseWeekCount,
  courseWeekOf,
  courseWeekRange,
  courseWeekStart,
  ledgerDelta,
  manualPointsSchema,
  parseCsv,
  parsePointsCsv,
  rankStandings,
  zoneOffsetMs,
} from './points';

const H = 3_600_000;

describe('course weeks (Cairo time)', () => {
  // Saturday 18 Oct 2026, 19:00 Cairo. Egypt's summer time (UTC+3) ends on the last
  // Thursday of October (29 Oct 2026 at midnight), so week 2 spans the change.
  const first = new Date('2026-10-18T16:00:00Z');

  it('starts week 1 at local midnight of the first session day', () => {
    expect(zoneOffsetMs(first, 'Africa/Cairo')).toBe(3 * H);
    expect(courseWeekStart(first, 1).toISOString()).toBe('2026-10-17T21:00:00.000Z');
  });

  it('keeps week boundaries at Cairo midnight across the DST change', () => {
    // Week 2 starts in summer time (UTC+3), week 3 in winter time (UTC+2).
    expect(courseWeekStart(first, 2).toISOString()).toBe('2026-10-24T21:00:00.000Z');
    expect(courseWeekStart(first, 3).toISOString()).toBe('2026-10-31T22:00:00.000Z');
    const w2 = courseWeekRange(first, 2);
    expect((w2.end.getTime() - w2.start.getTime()) / H).toBe(169);
    expect(courseWeekStart(first, 4).getTime() - courseWeekStart(first, 3).getTime()).toBe(168 * H);
  });

  it('puts instants in the right week right at the boundaries', () => {
    expect(courseWeekOf(first, new Date('2026-10-17T20:59:59Z'))).toBeNull();
    expect(courseWeekOf(first, new Date('2026-10-17T21:00:00Z'))).toBe(1);
    expect(courseWeekOf(first, new Date('2026-10-24T20:59:59Z'))).toBe(1);
    expect(courseWeekOf(first, new Date('2026-10-24T21:00:00Z'))).toBe(2);
    // 23:30 Cairo on Saturday 31 Oct (winter time) is still week 2; a naive 7×24h split says week 3.
    expect(courseWeekOf(first, new Date('2026-10-31T21:30:00Z'))).toBe(2);
    expect(courseWeekOf(first, new Date('2026-10-31T22:00:00Z'))).toBe(3);
    expect(courseWeekOf(first, new Date('2026-12-13T12:00:00Z'))).toBe(9);
  });

  it('handles the spring change too (UTC+2 → UTC+3, last Friday of April)', () => {
    const spring = new Date('2027-04-17T10:00:00Z');
    const w = courseWeekRange(spring, 2);
    expect((w.end.getTime() - w.start.getTime()) / H).toBe(167);
    expect(courseWeekOf(spring, new Date(w.end.getTime() - 1))).toBe(2);
  });

  it('ends a course at the end of its end date, or 7 days after the last session', () => {
    expect(courseEndsAt({ endDate: new Date('2026-12-13T10:00:00Z'), lastSessionAt: null })!.toISOString()).toBe('2026-12-13T22:00:00.000Z');
    expect(courseEndsAt({ endDate: null, lastSessionAt: new Date('2026-12-06T16:00:00Z') })!.toISOString()).toBe('2026-12-13T16:00:00.000Z');
    expect(courseEndsAt({ endDate: null, lastSessionAt: null })).toBeNull();
    expect(courseWeekCount(first, new Date('2026-12-13T22:00:00Z'))).toBe(9);
    expect(courseWeekCount(first, null)).toBeNull();
  });
});

describe('ranking', () => {
  const at = (h: number) => new Date(Date.UTC(2026, 9, 20) + h * H);

  it('shares ranks on ties (1, 1, 3) and orders ties by who got there first', () => {
    const r = rankStandings([
      { userId: 'c', points: 10, reachedAt: at(5) },
      { userId: 'a', points: 20, reachedAt: at(9) },
      { userId: 'b', points: 20, reachedAt: at(2) },
      { userId: 'd', points: 7, reachedAt: at(1) },
    ]);
    expect(r.map((x) => [x.userId, x.rank])).toEqual([
      ['b', 1],
      ['a', 1],
      ['c', 3],
      ['d', 4],
    ]);
  });

  it('leaves out students with no positive points', () => {
    const r = rankStandings([
      { userId: 'a', points: 0, reachedAt: at(1) },
      { userId: 'b', points: -5, reachedAt: at(1) },
      { userId: 'c', points: 1, reachedAt: at(1) },
    ]);
    expect(r).toEqual([{ userId: 'c', points: 1, reachedAt: at(1), rank: 1 }]);
  });
});

describe('ledger deltas', () => {
  it('awards the first time, with sequence 0', () => {
    expect(ledgerDelta([], 42)).toEqual({ points: 42, sourceSeq: 0 });
    expect(ledgerDelta([], 0)).toBeNull();
  });

  it('appends only the difference on a regrade, up or down', () => {
    expect(ledgerDelta([{ points: 42, sourceSeq: 0 }], 50)).toEqual({ points: 8, sourceSeq: 1 });
    expect(ledgerDelta([{ points: 42, sourceSeq: 0 }, { points: 8, sourceSeq: 1 }], 30)).toEqual({ points: -20, sourceSeq: 2 });
    expect(ledgerDelta([{ points: 42, sourceSeq: 0 }, { points: 8, sourceSeq: 1 }], 50)).toBeNull();
  });

  it('takes session points back when a session is unmarked, and gives them again', () => {
    expect(ledgerDelta([{ points: 5, sourceSeq: 0 }], 0)).toEqual({ points: -5, sourceSeq: 1 });
    expect(ledgerDelta([{ points: 5, sourceSeq: 0 }, { points: -5, sourceSeq: 1 }], 5)).toEqual({ points: 5, sourceSeq: 2 });
  });

  it('rounds counted scores to whole points', () => {
    expect(assessmentPoints(41.5)).toBe(42);
    expect(assessmentPoints(null)).toBe(0);
  });
});

describe('badge scopes (one award per scope)', () => {
  it('scopes weekly badges by course week, course badges by course, others globally', () => {
    expect(badgeScopeKey('c1', 3)).toBe('c1:w3');
    expect(badgeScopeKey('c1')).toBe('c1');
    expect(badgeScopeKey(null)).toBe('global');
  });
});

describe('names on boards', () => {
  it('shows first name + last initial only', () => {
    expect(boardName('Layla Member Salama')).toBe('Aya S.');
    expect(boardName('  omar  ')).toBe('omar');
    expect(boardName('آية ناصر')).toBe('آية ن.');
    expect(boardName(null)).toBe('—');
  });
});

describe('CSV import', () => {
  it('parses quotes, doubled quotes, CRLF and a BOM', () => {
    expect(parseCsv('\uFEFFa,b\r\n"x, y","say ""hi"""\n\n')).toEqual([
      ['a', 'b'],
      ['x, y', 'say "hi"'],
    ]);
  });

  it('validates each row and reports the line', () => {
    const r = parsePointsCsv('Email,Points,Note,Course\nA@X.io,10,Helped on Telegram,ai-arch\nbad,5,,\nb@x.io,0,,\nc@x.io,-3,,\n');
    expect(r.rows).toEqual([
      { line: 2, email: 'a@x.io', points: 10, note: 'Helped on Telegram', courseSlug: 'ai-arch' },
      { line: 5, email: 'c@x.io', points: -3, note: null, courseSlug: null },
    ]);
    expect(r.errors.map((e) => e.line)).toEqual([3, 4]);
  });

  it('needs the header row', () => {
    expect(parsePointsCsv('a@x.io,10').errors[0]!.line).toBe(1);
  });
});

describe('manual points input', () => {
  it('needs whole, non-zero points and a note', () => {
    expect(manualPointsSchema.safeParse({ points: 0, reason: 'MANUAL_OTHER', note: 'x' }).success).toBe(false);
    expect(manualPointsSchema.safeParse({ points: 2.5, reason: 'MANUAL_OTHER', note: 'x' }).success).toBe(false);
    expect(manualPointsSchema.safeParse({ points: 5, reason: 'MANUAL_OTHER', note: '' }).success).toBe(false);
    expect(manualPointsSchema.parse({ points: '-5', reason: 'ADJUSTMENT', note: 'Fix', courseId: '' })).toEqual({ points: -5, reason: 'ADJUSTMENT', note: 'Fix', courseId: null });
  });
});
