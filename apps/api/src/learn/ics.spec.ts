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
});
