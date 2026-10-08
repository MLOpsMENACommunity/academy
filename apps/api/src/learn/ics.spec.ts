import { buildIcs } from './ics';

describe('buildIcs', () => {
  it('produces a valid calendar with escaped, folded text and UTC times', () => {
    const ics = buildIcs('Course; One', [
      { uid: 's1', title: 'Session, one', description: 'Line1\nLine2 ' + 'x'.repeat(120), url: 'https://academy/x', start: new Date('2026-10-22T17:00:00Z'), durationMin: 90 },
    ]);
    expect(ics.startsWith('BEGIN:VCALENDAR\r\n')).toBe(true);
    expect(ics).toContain('DTSTART:20261022T170000Z');
    expect(ics).toContain('DTEND:20261022T183000Z');
    expect(ics).toContain('SUMMARY:Session\\, one');
    // RFC 5545 escapes ';' and ',' with a backslash.
    expect(ics).toContain('X-WR-CALNAME:Course\\; One');
    for (const line of ics.split('\r\n')) expect(Buffer.byteLength(line)).toBeLessThanOrEqual(75);
  });

  it('keeps one domain in the UID and marks cancelled entries', () => {
    const ics = buildIcs('S', [
      { uid: 'event-abc', title: 'S', description: '', url: 'https://academy/x', start: new Date('2026-10-22T17:00:00Z'), durationMin: 60, cancelled: true },
    ]);
    expect(ics).toContain('UID:event-abc@academy.mlopsmena.com\r\n');
    expect(ics).toContain('STATUS:CANCELLED');
    expect(buildIcs('S', [{ uid: 'x', title: 'S', description: '', url: 'u', start: new Date(), durationMin: 60 }])).not.toContain('STATUS:');
  });
});

describe('buildIcs for subscription feeds', () => {
  const at = new Date('2026-10-22T17:00:00Z');
  const base = { uid: 's1', title: 'جلسة: مقدمة', description: 'Join from your course page: https://a/x', url: 'https://a/x', start: at, durationMin: 60 };

  it('adds refresh hints only when asked', () => {
    const feed = buildIcs('MLOps MENA Academy', [base], at, { refreshInterval: 'PT1H', description: 'Private' });
    expect(feed).toContain('REFRESH-INTERVAL;VALUE=DURATION:PT1H');
    expect(feed).toContain('X-PUBLISHED-TTL:PT1H');
    expect(feed).toContain('X-WR-CALDESC:Private');
    expect(buildIcs('x', [base], at)).not.toContain('REFRESH-INTERVAL');
  });

  it('versions events by their last change so reschedules propagate', () => {
    const v1 = buildIcs('x', [{ ...base, updatedAt: new Date('2026-10-01T00:00:00Z') }], at);
    const v2 = buildIcs('x', [{ ...base, updatedAt: new Date('2026-10-02T00:00:00Z') }], at);
    const seq = (s: string) => Number(/SEQUENCE:(\d+)/.exec(s)![1]);
    expect(seq(v2)).toBeGreaterThan(seq(v1));
    expect(v2).toContain('LAST-MODIFIED:20261002T000000Z');
    expect(v1).toContain('UID:s1@academy.mlopsmena.com');
  });

  it('marks cancelled events and keeps Arabic text intact across folds', () => {
    const ics = buildIcs('x', [{ ...base, title: 'ج'.repeat(60), cancelled: true }], at);
    expect(ics).toContain('STATUS:CANCELLED');
    const unfolded = ics.replace(/\r\n /g, '');
    expect(unfolded).toContain(`SUMMARY:${'ج'.repeat(60)}`);
    for (const line of ics.split('\r\n')) expect(Buffer.byteLength(line)).toBeLessThanOrEqual(75);
  });
});
