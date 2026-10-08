/** Minimal RFC 5545 calendar for course sessions (UTC times, no live links inside). */
export interface IcsEvent {
  uid: string;
  title: string;
  description: string;
  url: string;
  start: Date;
  durationMin: number;
  /** Drives SEQUENCE/LAST-MODIFIED so calendars apply reschedules. */
  updatedAt?: Date;
  /** Marks the entry cancelled so calendars that re-import the file drop it. */
  cancelled?: boolean;
}

const stamp = (d: Date) => d.toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, '');
const escape = (s: string) => s.replace(/\\/g, '\\\\').replace(/;/g, '\\;').replace(/,/g, '\\,').replace(/\r\n|\r|\n/g, '\\n');

/** Folds lines longer than 75 octets, as the spec requires. */
function fold(line: string): string {
  // Split on code points (never inside an emoji or Arabic letter), at most 75 octets per line.
  const out: string[] = [];
  let current = '';
  for (const ch of Array.from(line)) {
    if (Buffer.byteLength(current + ch) > 75) {
      out.push(current);
      current = ` ${ch}`;
    } else {
      current += ch;
    }
  }
  out.push(current);
  return out.join('\r\n');
}

export function buildIcs(calendarName: string, events: IcsEvent[], now = new Date()): string {
  const lines = [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'PRODID:-//MLOps MENA Academy//Courses//EN',
    'CALSCALE:GREGORIAN',
    'METHOD:PUBLISH',
    `X-WR-CALNAME:${escape(calendarName)}`,
  ];
  for (const e of events) {
    const end = new Date(e.start.getTime() + e.durationMin * 60_000);
    lines.push(
      'BEGIN:VEVENT',
      `UID:${e.uid}@academy.mlopsmena.com`,
      `DTSTAMP:${stamp(now)}`,
      ...(e.updatedAt ? [`LAST-MODIFIED:${stamp(e.updatedAt)}`, `SEQUENCE:${Math.max(0, Math.floor((e.updatedAt.getTime() - Date.UTC(2026, 0, 1)) / 1000))}`] : []),
      `DTSTART:${stamp(e.start)}`,
      `DTEND:${stamp(end)}`,
      `SUMMARY:${escape(e.title)}`,
      `DESCRIPTION:${escape(e.description)}`,
      `URL:${e.url}`,
      ...(e.cancelled ? ['STATUS:CANCELLED'] : []),
      'BEGIN:VALARM',
      'TRIGGER:-PT30M',
      'ACTION:DISPLAY',
      `DESCRIPTION:${escape(e.title)}`,
      'END:VALARM',
      'END:VEVENT',
    );
  }
  lines.push('END:VCALENDAR');
  return lines.map(fold).join('\r\n') + '\r\n';
}
