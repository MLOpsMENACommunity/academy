import { describe, expect, it } from 'vitest';
import {
  attendancePoints,
  attendanceSettingsSchema,
  attendanceStatus,
  attendanceUploadSchema,
  ATTENDANCE_DEFAULTS,
  canonicalEmail,
  clockMinutes,
  matchAttendance,
  MAX_ATTENDANCE_ROWS,
  normaliseName,
  parseAttendanceSheet,
  parseClock,
  parseDuration,
} from './attendance';
import { parseCsv } from './csv';

// Every name and address below is made up.

describe('parseDuration', () => {
  it.each([
    ['1:23:45', 83.75],
    ['01:23:45', 83.75],
    ['0:45:00', 45],
    ['00:00:30', 0.5],
    ['1:05', 65],
    ['85', 85],
    ['85 min', 85],
    ['85min', 85],
    ['85 mins', 85],
    ['45 minutes', 45],
    ['1 minute', 1],
    ['1 hr 5 min', 65],
    ['1 hr', 60],
    ['2 hrs 10 mins', 130],
    ['1 hour 5 minutes', 65],
    ['1 hour and 5 minutes', 65],
    ['1h 5m 30s', 65.5],
    ['1h5m', 65],
    ['1.5 hours', 90],
    ['1,5 h', 90],
    ['90 seconds', 1.5],
    ['  54 MIN  ', 54],
    ['٤٥ دقيقة', 45],
    ['ساعة 1', null],
    ['1 ساعة و 5 دقائق', 65],
    ['0.0625', 90],
    ['1899-12-30T01:23:45.000Z', 83.75],
    ['1899-12-31T00:10:00.000Z', 1450],
  ])('%s → %s minutes', (raw, minutes) => {
    const got = parseDuration(raw);
    if (minutes === null) expect(got).toBeNull();
    else expect(got).toBeCloseTo(minutes, 5);
  });

  it.each(['', '   ', 'abc', 'n/a', '1 month', '5 min ago', '-5', '1:75', '12 apples', '--'])('rejects %j', (raw) => {
    expect(parseDuration(raw)).toBeNull();
  });

  it('reads numbers as minutes, and a fraction of a day as an Excel time', () => {
    expect(parseDuration(85)).toBe(85);
    expect(parseDuration(0.5)).toBe(720);
    expect(parseDuration(null)).toBeNull();
    expect(parseDuration(Number.NaN)).toBeNull();
  });
});

describe('clock times', () => {
  it('reads 12- and 24-hour times, with or without seconds', () => {
    expect(parseClock('7:01 PM')).toEqual({ ms: (19 * 60 + 1) * 60_000, dated: false });
    expect(parseClock('7:01:30 pm')).toEqual({ ms: ((19 * 60 + 1) * 60 + 30) * 1000, dated: false });
    expect(parseClock('12:15 AM')!.ms).toBe(15 * 60_000);
    expect(parseClock('12:15 PM')!.ms).toBe(12 * 3_600_000 + 15 * 60_000);
    expect(parseClock('19:01')!.ms).toBe((19 * 60 + 1) * 60_000);
    expect(parseClock('٧:٠١ م')!.ms).toBe((19 * 60 + 1) * 60_000);
    expect(parseClock('7:01 PM')!.ms).toBe((19 * 60 + 1) * 60_000);
    expect(parseClock('13:00 PM')).toBeNull();
    expect(parseClock('nope')).toBeNull();
  });

  it('reads date-times', () => {
    expect(parseClock('2026-10-12 19:01:23')).toEqual({ ms: Date.parse('2026-10-12T19:01:23'), dated: true });
    expect(parseClock('2026-10-12T19:01:23Z')).toEqual({ ms: Date.parse('2026-10-12T19:01:23Z'), dated: true });
  });

  it('works out minutes between join and exit, across midnight too', () => {
    expect(clockMinutes('7:01 PM', '8:31 PM')).toBe(90);
    expect(clockMinutes('11:30 PM', '12:15 AM')).toBe(45);
    expect(clockMinutes('2026-10-12 19:00:00', '2026-10-12 19:45:30')).toBe(45.5);
    expect(clockMinutes('7:00 PM', '')).toBeNull();
    expect(clockMinutes('7:00 PM', '2026-10-12 19:45:30')).toBeNull();
  });
});

describe('parseAttendanceSheet: the Google Workspace report', () => {
  const csv = [
    'First name,Last name,Email,Duration,Time joined,Time exited',
    'Layla,Haddad,layla.haddad@example.test,1 hr 25 min,7:00 PM,8:25 PM',
    'Omar,Farouk,OMAR.F@example.test,40 min,7:10 PM,7:50 PM',
    // Omar rejoined: the two rows add up.
    'Omar,Farouk,omar.f@example.test,15 min,8:00 PM,8:15 PM',
    'Guest,Visitor,,5 min,7:00 PM,7:05 PM',
  ].join('\n');

  it('reads every person once, with rejoins added together', () => {
    const r = parseAttendanceSheet(parseCsv(csv));
    expect(r.format).toBe('workspace');
    expect(r.headerRow).toBe(1);
    expect(r.errors).toEqual([]);
    expect(r.records).toEqual([
      { name: 'Layla Haddad', email: 'layla.haddad@example.test', minutes: 85, rows: [2] },
      { name: 'Omar Farouk', email: 'omar.f@example.test', minutes: 55, rows: [3, 4] },
      { name: 'Guest Visitor', email: null, minutes: 5, rows: [5] },
    ]);
  });

  it('skips title rows above the header and keeps sheet row numbers', () => {
    const r = parseAttendanceSheet(parseCsv(`Meeting code: abc-defg-hij\nDate: 2026-10-12\n\n${csv}`, { keepEmpty: true }));
    expect(r.headerRow).toBe(4);
    expect(r.records[0]!.rows).toEqual([5]);
  });

  it('works out minutes from the join and exit times when there is no duration', () => {
    const r = parseAttendanceSheet(parseCsv('First Name,Last Name,Email,Time Joined,Time Exited\nNour,Saleh,nour@example.test,7:00 PM,7:45 PM'));
    expect(r.records).toEqual([{ name: 'Nour Saleh', email: 'nour@example.test', minutes: 45, rows: [2] }]);
  });

  it('reads Arabic column names', () => {
    const r = parseAttendanceSheet([
      ['الاسم الأول', 'اسم العائلة', 'البريد الإلكتروني', 'المدة'],
      ['ليلى', 'حداد', 'layla@example.test', '٥٠ دقيقة'],
    ]);
    expect(r.records).toEqual([{ name: 'ليلى حداد', email: 'layla@example.test', minutes: 50, rows: [2] }]);
  });

  it('reports rows it cannot read and keeps the rest', () => {
    const r = parseAttendanceSheet(parseCsv('First name,Last name,Email,Duration\n,,,10 min\nSami,Nabil,sami@example.test,a while\nRana,Aziz,rana@example.test,30 min', { keepEmpty: true }));
    expect(r.errors).toEqual([
      { row: 2, code: 'NO_IDENTITY' },
      { row: 3, code: 'BAD_DURATION' },
    ]);
    expect(r.records.map((x) => x.email)).toEqual(['rana@example.test']);
  });
});

describe('parseAttendanceSheet: Chrome extension exports', () => {
  it('reads Name / Email / First seen / Last seen / Time in call', () => {
    const r = parseAttendanceSheet(
      parseCsv(
        [
          'Name,Email,First seen,Last seen,Time in call',
          'Layla Haddad,layla.haddad@example.test,7:00 PM,8:30 PM,01:25:10',
          'Karim Mansour,,7:05 PM,7:20 PM,00:15:00',
          // The same person twice with no email: added up by name.
          'karim  mansour,,7:40 PM,7:50 PM,00:10:00',
        ].join('\r\n'),
      ),
    );
    expect(r.format).toBe('extension');
    expect(r.records).toEqual([
      { name: 'Layla Haddad', email: 'layla.haddad@example.test', minutes: 85.2, rows: [2] },
      { name: 'Karim Mansour', email: null, minutes: 25, rows: [3, 4] },
    ]);
  });

  it('reads a "Duration" column in minutes and a "Participant" column', () => {
    const r = parseAttendanceSheet([
      ['Participant', 'Duration (minutes)'],
      ['Hana Youssef', '62'],
    ]);
    expect(r.records).toEqual([{ name: 'Hana Youssef', email: null, minutes: 62, rows: [2] }]);
  });

  it('falls back to first and last seen when there is no time in call', () => {
    const r = parseAttendanceSheet([
      ['Full Name', 'First Seen', 'Last Seen'],
      ['Hana Youssef', '19:00', '20:00'],
    ]);
    expect(r.records[0]!.minutes).toBe(60);
  });

  it('counts snapshot columns: one mark per interval', () => {
    const r = parseAttendanceSheet([
      ['Meet Attendance', '', '', '', ''],
      ['Name', '7:00 PM', '7:10 PM', '7:20 PM', '7:30 PM'],
      ['Layla Haddad', '✔', '✔', '✔', '✔'],
      ['Karim Mansour', '✔', '', '', '✔'],
      ['Sara Adel', '', '', '', ''],
    ]);
    expect(r.format).toBe('snapshots');
    expect(r.headerRow).toBe(2);
    expect(r.records).toEqual([
      { name: 'Layla Haddad', email: null, minutes: 40, rows: [3] },
      { name: 'Karim Mansour', email: null, minutes: 20, rows: [4] },
      { name: 'Sara Adel', email: null, minutes: 0, rows: [5] },
    ]);
  });

  it('reads Excel cells turned into text (time cells as 1899 dates, numbers as fractions)', () => {
    const r = parseAttendanceSheet([
      ['Name', 'Email', 'Time in call'],
      ['Layla Haddad', 'layla@example.test', '1899-12-30T00:50:00.000Z'],
      ['Omar Farouk', 'omar@example.test', '0.03125'],
    ]);
    expect(r.records.map((x) => x.minutes)).toEqual([50, 45]);
  });
});

describe('parseAttendanceSheet: files it cannot read', () => {
  it.each([
    [[], 'EMPTY'],
    [[['', '']], 'EMPTY'],
    [[['Participants'], ['Layla Haddad']], 'NO_HEADER'],
    [[['Course', 'Week'], ['MLOps', '1']], 'NO_HEADER'],
    [[['Name', 'Email'], ['Layla', 'l@example.test']], 'NO_DURATION'],
  ])('%j → %s', (table, code) => {
    const r = parseAttendanceSheet(table as string[][]);
    expect(r.records).toEqual([]);
    expect(r.errors).toEqual([{ row: 0, code }]);
  });

  it('refuses more than the row limit', () => {
    const table = [['Name', 'Duration'], ...Array.from({ length: MAX_ATTENDANCE_ROWS + 1 }, (_, i) => [`P${i}`, '1'])];
    expect(parseAttendanceSheet(table).errors).toEqual([{ row: 0, code: 'TOO_MANY_ROWS' }]);
  });

  it('caps one person at a day', () => {
    expect(parseAttendanceSheet([['Name', 'Duration'], ['A B', '30 hours']]).records[0]!.minutes).toBe(1440);
  });
});

describe('the attendance rule and points', () => {
  it('is PRESENT at or above the threshold, PARTIAL below it, ABSENT under a minute', () => {
    expect(attendanceStatus(45, 90, 50)).toEqual({ percent: 50, status: 'PRESENT' });
    expect(attendanceStatus(44.9, 90, 50)).toEqual({ percent: 50, status: 'PARTIAL' });
    expect(attendanceStatus(10, 90, 50)).toEqual({ percent: 11, status: 'PARTIAL' });
    expect(attendanceStatus(0.5, 90, 50)).toEqual({ percent: 1, status: 'ABSENT' });
    expect(attendanceStatus(0, 90, 50)).toEqual({ percent: 0, status: 'ABSENT' });
    expect(attendanceStatus(200, 90, 50)).toEqual({ percent: 100, status: 'PRESENT' });
    expect(attendanceStatus(60, 90, 75)).toEqual({ percent: 67, status: 'PARTIAL' });
    expect(attendanceStatus(90, 90, 100)).toEqual({ percent: 100, status: 'PRESENT' });
    expect(attendanceStatus(Number.NaN, 90, 50).status).toBe('ABSENT');
    expect(attendanceStatus(5, 0, 50).status).toBe('PRESENT');
  });

  it('gives the course points for each status (defaults 10 / 5 / 0)', () => {
    expect(ATTENDANCE_DEFAULTS).toEqual({ presentPercent: 50, presentPoints: 10, partialPoints: 5, absentPoints: 0 });
    expect(attendancePoints('PRESENT', ATTENDANCE_DEFAULTS)).toBe(10);
    expect(attendancePoints('PARTIAL', ATTENDANCE_DEFAULTS)).toBe(5);
    expect(attendancePoints('ABSENT', ATTENDANCE_DEFAULTS)).toBe(0);
  });

  it('validates course settings', () => {
    expect(attendanceSettingsSchema.parse({ presentPercent: '60', presentPoints: 10, partialPoints: 5, absentPoints: 0 }).presentPercent).toBe(60);
    expect(attendanceSettingsSchema.safeParse({ presentPercent: 0, presentPoints: 10, partialPoints: 5, absentPoints: 0 }).success).toBe(false);
    expect(attendanceSettingsSchema.safeParse({ presentPercent: 50, presentPoints: -1, partialPoints: 5, absentPoints: 0 }).success).toBe(false);
  });

  it('validates an upload', () => {
    const ok = attendanceUploadSchema.parse({ records: [{ name: ' A ', email: ' A@Example.Test ', minutes: 5 }] });
    expect(ok).toMatchObject({ dryRun: true, assign: [], ignore: [], statuses: [], records: [{ name: 'A', email: 'a@example.test', minutes: 5 }] });
    expect(attendanceUploadSchema.safeParse({ records: [{ name: 'A', minutes: -1 }] }).success).toBe(false);
    expect(attendanceUploadSchema.safeParse({ records: [], presentPercent: 101 }).success).toBe(false);
  });
});

describe('matching to enrolled students', () => {
  const students = [
    { userId: 'u1', emails: ['layla.haddad@example.test'], names: ['Layla Haddad'] },
    { userId: 'u2', emails: ['omar@example.test', 'omar.farouk@gmail.com'], names: ['Omar Farouk'] },
    { userId: 'u3', emails: ['sara1@example.test'], names: ['Sara Adel'] },
    { userId: 'u4', emails: ['sara2@example.test'], names: ['Sara Adel'] },
  ];

  it('matches by email, case-insensitive, including the Google account email', () => {
    expect(matchAttendance([{ name: 'x', email: 'LAYLA.HADDAD@example.test' }, { name: '', email: 'omar.farouk@gmail.com' }], students)).toEqual([
      { userId: 'u1', by: 'EMAIL' },
      { userId: 'u2', by: 'EMAIL' },
    ]);
  });

  it('applies Gmail dot and plus rules on gmail.com only', () => {
    expect(canonicalEmail('Omar.Farouk+meet@GoogleMail.com')).toBe('omarfarouk@gmail.com');
    expect(canonicalEmail('layla.haddad+x@example.test')).toBe('layla.haddad+x@example.test');
    expect(matchAttendance([{ name: '', email: 'omarfarouk+class@gmail.com' }], students)).toEqual([{ userId: 'u2', by: 'EMAIL' }]);
    expect(matchAttendance([{ name: '', email: 'laylahaddad@example.test' }], students)).toEqual([null]);
  });

  it('falls back to an exact full name, but only when one student has it', () => {
    expect(matchAttendance([{ name: '  layla   HADDAD ', email: null }], students)).toEqual([{ userId: 'u1', by: 'NAME' }]);
    expect(matchAttendance([{ name: 'Layla', email: null }], students)).toEqual([null]);
    expect(matchAttendance([{ name: 'Sara Adel', email: null }], students)).toEqual([null]);
    // An unknown email still gets the name check.
    expect(matchAttendance([{ name: 'Omar Farouk', email: 'someone@else.test' }], students)).toEqual([{ userId: 'u2', by: 'NAME' }]);
  });

  it('never gives one address to two students', () => {
    const clash = [
      { userId: 'a', emails: ['ab@gmail.com'], names: [] },
      { userId: 'b', emails: ['a.b@gmail.com'], names: [] },
    ];
    expect(matchAttendance([{ name: '', email: 'a.b@gmail.com' }], clash)).toEqual([{ userId: 'b', by: 'EMAIL' }]);
    expect(matchAttendance([{ name: '', email: 'a.b.+x@gmail.com' }], clash)).toEqual([null]);
  });

  it('normalises names', () => {
    expect(normaliseName('  Ｌａｙｌａ‏  Haddad ')).toBe('layla haddad');
    expect(normaliseName(null)).toBe('');
  });
});
