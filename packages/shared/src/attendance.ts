import { z } from 'zod';
import { ATTENDANCE_STATUSES, type AttendanceSource, type AttendanceStatus } from './enums';

/**
 * Attendance from Google Meet. A speaker or an academic admin uploads the attendance file of
 * one course session (.csv or .xlsx); it is read in the browser (parseAttendanceSheet), the
 * rows are matched to the enrolled students on the server (matchAttendance), each student
 * gets PRESENT / PARTIAL / ABSENT (attendanceStatus) and attendance points (attendancePoints).
 *
 * Two kinds of file are understood, whatever the column order, case or spelling:
 *
 *  - the Google Workspace Meet attendance report:
 *      First name, Last name, Email, Duration, Time joined, Time exited
 *  - the "Google Meet Attendance List" / "Meet Attendance" Chrome extensions:
 *      Name, Email (often missing), First seen, Last seen, Time in call (or Duration),
 *      and sometimes one column per snapshot time ("7:05 PM", "7:10 PM", …) with a mark
 *      in each cell where the person was in the call.
 *
 * Title rows above the header (meeting code, date) are skipped. Rows for the same person
 * (same email, or the same name when there is no email) are added together: Meet writes a
 * row each time someone rejoins.
 */

// ------------------------------------------------------------------ settings

/** Course defaults (Course.attendance* columns). */
export const ATTENDANCE_DEFAULTS = { presentPercent: 50, presentPoints: 10, partialPoints: 5, absentPoints: 0 } as const;

/** At most this many rows in one file (after title rows). */
export const MAX_ATTENDANCE_ROWS = 2000;

/** How long a single record can be, in minutes (a day). */
export const MAX_ATTENDANCE_MINUTES = 24 * 60;

export interface AttendanceSettings {
  /** PRESENT at or above this share of the session's duration (1–100). */
  presentPercent: number;
  presentPoints: number;
  partialPoints: number;
  absentPoints: number;
}

export const attendanceSettingsSchema = z.object({
  presentPercent: z.coerce.number().int('Whole numbers only').min(1, 'Between 1 and 100').max(100, 'Between 1 and 100'),
  presentPoints: z.coerce.number().int('Whole numbers only').min(0, 'Between 0 and 1000').max(1000, 'Between 0 and 1000'),
  partialPoints: z.coerce.number().int('Whole numbers only').min(0, 'Between 0 and 1000').max(1000, 'Between 0 and 1000'),
  absentPoints: z.coerce.number().int('Whole numbers only').min(0, 'Between 0 and 1000').max(1000, 'Between 0 and 1000'),
});
export type AttendanceSettingsInput = z.infer<typeof attendanceSettingsSchema>;

// ------------------------------------------------------------------ the rule

/**
 * Minutes attended → share of the session (0–100, rounded) and a status: PRESENT at or above
 * `presentPercent` of the session's duration, PARTIAL for at least a minute less than that,
 * ABSENT otherwise. Time beyond the session's length (an early join, overlapping rows) caps at 100%.
 */
export function attendanceStatus(minutes: number, durationMin: number, presentPercent: number): { percent: number; status: AttendanceStatus } {
  const m = Number.isFinite(minutes) && minutes > 0 ? minutes : 0;
  if (durationMin <= 0) return { percent: m > 0 ? 100 : 0, status: m >= 1 ? 'PRESENT' : 'ABSENT' };
  const share = (m / durationMin) * 100;
  const percent = Math.min(100, Math.round(share));
  if (share >= presentPercent) return { percent, status: 'PRESENT' };
  return { percent, status: m >= 1 ? 'PARTIAL' : 'ABSENT' };
}

export function attendancePoints(status: AttendanceStatus, s: Pick<AttendanceSettings, 'presentPoints' | 'partialPoints' | 'absentPoints'>): number {
  return status === 'PRESENT' ? s.presentPoints : status === 'PARTIAL' ? s.partialPoints : s.absentPoints;
}

// ------------------------------------------------------------------ durations and times

const UNIT_MINUTES: Record<string, number> = {
  h: 60, hr: 60, hrs: 60, hour: 60, hours: 60, 'ساعة': 60, 'ساعات': 60, 'س': 60,
  m: 1, min: 1, mins: 1, minute: 1, minutes: 1, 'دقيقة': 1, 'دقائق': 1, 'د': 1,
  s: 1 / 60, sec: 1 / 60, secs: 1 / 60, second: 1 / 60, seconds: 1 / 60, 'ثانية': 1 / 60, 'ثوان': 1 / 60, 'ثواني': 1 / 60, 'ث': 1 / 60,
};
const UNIT_RE = /(\d+(?:[.,]\d+)?)\s*(hours|hour|hrs|hr|h|minutes|minute|mins|min|m|seconds|second|secs|sec|s|ساعات|ساعة|دقائق|دقيقة|ثواني|ثوان|ثانية|س|د|ث)(?![a-z\u0600-\u06ff])/giu;
/** Excel stores times as days since 30 Dec 1899; read-excel-file hands a time-only cell back as such a date. */
const EXCEL_EPOCH = Date.UTC(1899, 11, 30);

/** Arabic-Indic digits → ASCII. */
function asciiDigits(s: string): string {
  return s.replace(/[\u0660-\u0669]/g, (d) => String(d.charCodeAt(0) - 0x0660)).replace(/[\u06f0-\u06f9]/g, (d) => String(d.charCodeAt(0) - 0x06f0));
}

/**
 * A duration as minutes (may be fractional), or null when it isn't one:
 *  - `1:23:45` (h:mm:ss) and `1:23` (h:mm: spreadsheets write hours first);
 *  - units: `85 min`, `1 hr 5 min`, `45 minutes`, `1h 5m 30s`, `1.5 hours`, `٤٥ دقيقة`;
 *  - a bare number: minutes (`85`), except a fraction below 1 (`0.0625`), which is an Excel
 *    time read as a number (a share of a day: 0.0625 = 90 minutes);
 *  - an Excel time cell turned into a date by the reader (`1899-12-30T01:23:45.000Z`).
 */
export function parseDuration(raw: string | number | null | undefined): number | null {
  if (raw === null || raw === undefined) return null;
  if (typeof raw === 'number') return Number.isFinite(raw) && raw >= 0 ? (raw > 0 && raw < 1 ? raw * 1440 : raw) : null;
  const s = asciiDigits(String(raw)).trim().toLowerCase();
  if (!s) return null;
  const excel = /^(1899-12-3[01]|1900-01-0\d)t\d\d:\d\d:\d\d(\.\d+)?z?$/.exec(s);
  if (excel) {
    const t = Date.parse(s.endsWith('z') ? s : `${s}z`);
    return Number.isNaN(t) ? null : Math.max(0, (t - EXCEL_EPOCH) / 60_000);
  }
  let m = /^(\d+):([0-5]?\d):([0-5]?\d)(?:[.,]\d+)?$/.exec(s);
  if (m) return Number(m[1]) * 60 + Number(m[2]) + Number(m[3]) / 60;
  m = /^(\d+):([0-5]\d)$/.exec(s);
  if (m) return Number(m[1]) * 60 + Number(m[2]);
  if (/^\d+(?:[.,]\d+)?$/.test(s)) {
    const n = Number(s.replace(',', '.'));
    return n > 0 && n < 1 ? n * 1440 : n;
  }
  // Units: every part of the text must be a number with a unit (separators allowed).
  let total = 0;
  let found = false;
  const rest = s.replace(UNIT_RE, (_all, n: string, unit: string) => {
    found = true;
    total += Number(n.replace(',', '.')) * UNIT_MINUTES[unit.toLowerCase()]!;
    return ' ';
  });
  const leftover = rest.replace(/\band\b/g, ' ').replace(/[\s,;&و]+/g, '');
  if (!found || leftover) return null;
  return total;
}

/**
 * A clock time or a date-time, as milliseconds: since midnight for a time alone
 * (`7:01 PM`, `19:01:23`, `٧:٠١ م`), since the epoch when a date comes with it
 * (`2026-10-12 19:01:23`, `10/12/2026, 7:01:23 PM`, ISO). Null when it isn't one.
 */
export function parseClock(raw: string | null | undefined): { ms: number; dated: boolean } | null {
  if (!raw) return null;
  let s = asciiDigits(String(raw)).trim();
  if (!s) return null;
  // Excel time-only cell read as a date: just the time of day.
  const excel = /^(1899-12-3[01]|1900-01-0\d)T(\d\d):(\d\d):(\d\d)/i.exec(s);
  if (excel) return { ms: ((Number(excel[2]) * 60 + Number(excel[3])) * 60 + Number(excel[4])) * 1000, dated: false };
  s = s
    .replace(/[\u202f\u00a0]/g, ' ')
    .replace(/\s*ص$/u, ' AM')
    .replace(/\s*م$/u, ' PM');
  const time = /^(\d{1,2}):(\d{2})(?::(\d{2})(?:\.\d+)?)?\s*([ap]\.?m\.?)?$/i.exec(s);
  if (time) {
    let h = Number(time[1]);
    const ap = time[4]?.toLowerCase().replace(/\./g, '');
    if (h > 23 || Number(time[2]) > 59 || (ap && (h < 1 || h > 12))) return null;
    if (ap === 'pm' && h < 12) h += 12;
    if (ap === 'am' && h === 12) h = 0;
    return { ms: ((h * 60 + Number(time[2])) * 60 + Number(time[3] ?? 0)) * 1000, dated: false };
  }
  // A date with a time: let the platform read it (ISO, "2026-10-12 19:01", "10/12/2026, 7:01:23 PM").
  if (/\d{4}|\d{1,2}\/\d{1,2}\/\d{2,4}/.test(s) && /\d:\d\d/.test(s)) {
    const t = Date.parse(s.replace(/^(\d{4}-\d{2}-\d{2}) (\d)/, '$1T$2').replace(',', ''));
    if (!Number.isNaN(t)) return { ms: t, dated: true };
  }
  return null;
}

/** Minutes between two clock readings; a time-only exit before the join crossed midnight. */
export function clockMinutes(joined: string | null | undefined, exited: string | null | undefined): number | null {
  const a = parseClock(joined);
  const b = parseClock(exited);
  if (!a || !b || a.dated !== b.dated) return null;
  let d = b.ms - a.ms;
  if (d < 0 && !a.dated) d += 86_400_000;
  return d >= 0 ? d / 60_000 : null;
}

// ------------------------------------------------------------------ the sheet

export type AttendanceFormat = 'workspace' | 'extension' | 'snapshots';

export interface AttendanceRecord {
  /** As written in the file ("First Last" for the Workspace report). */
  name: string;
  /** Lowercased; null when the file has none for this person. */
  email: string | null;
  /** Total minutes in the call (rows for the same person added up), one decimal. */
  minutes: number;
  /** Sheet row numbers (1-based, as a spreadsheet shows them) this record came from. */
  rows: number[];
}

export type AttendanceSheetErrorCode = 'EMPTY' | 'NO_HEADER' | 'NO_DURATION' | 'TOO_MANY_ROWS' | 'BAD_DURATION' | 'NO_IDENTITY';

export interface AttendanceSheetError {
  /** 1-based sheet row; 0 for the whole file. */
  row: number;
  code: AttendanceSheetErrorCode;
}

export interface AttendanceSheetResult {
  format: AttendanceFormat | null;
  records: AttendanceRecord[];
  /** Rows that were skipped, and why. A file-level problem has row 0 and no records. */
  errors: AttendanceSheetError[];
  /** The header row's number (1-based), when one was found. */
  headerRow: number | null;
}

/** "Time in call (min)" → "timeincallmin". Letters and digits only, any script. */
function headerKey(h: string): string {
  return h
    .normalize('NFKC')
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, '');
}

const SYNONYMS = {
  firstName: ['firstname', 'givenname', 'first', 'الاسمالأول', 'الاسمالاول'],
  lastName: ['lastname', 'surname', 'familyname', 'last', 'اسمالعائلة', 'الاسمالأخير', 'الاسمالاخير'],
  name: ['name', 'fullname', 'participant', 'participantname', 'participants', 'attendee', 'attendeename', 'attendees', 'displayname', 'student', 'studentname', 'user', 'username', 'الاسم', 'الاسمالكامل', 'المشارك'],
  email: ['email', 'emailaddress', 'emails', 'mail', 'participantemail', 'attendeeemail', 'useremail', 'gmail', 'البريدالإلكتروني', 'البريدالالكتروني', 'البريد'],
  duration: [
    'duration', 'durationmin', 'durationmins', 'durationminutes', 'durationhhmmss', 'timeincall', 'timeincallmin', 'timeincallminutes', 'timeincallhhmmss', 'totalduration',
    'totaltime', 'totaltimeincall', 'attendedduration', 'attendanceduration', 'timeattended', 'minutes', 'minutesattended', 'attendedminutes', 'callduration', 'meetingduration', 'المدة', 'مدةالحضور', 'المدةبالدقائق',
  ],
  joined: ['timejoined', 'firstseen', 'jointime', 'joined', 'joinedat', 'firstjoined', 'join', 'firstjoin', 'timein', 'checkin', 'وقتالانضمام', 'أولظهور'],
  exited: ['timeexited', 'lastseen', 'leavetime', 'left', 'leftat', 'lastleft', 'exittime', 'exited', 'lastexit', 'timeout', 'checkout', 'timeleft', 'وقتالمغادرة', 'آخرظهور'],
} as const;
type Column = keyof typeof SYNONYMS;

/** A header that is itself a snapshot time ("7:05 PM", "19:05", "2026-10-12 19:05"). */
function snapshotTime(h: string): number | null {
  const c = parseClock(h);
  return c ? c.ms : null;
}

/** A snapshot cell that says "was in the call": anything but empty, 0, no, absent, ✗. */
function marked(cell: string): boolean {
  const v = cell.trim().toLowerCase();
  return v !== '' && !['0', 'no', 'n', 'false', 'absent', 'a', '✗', '✘', 'x̶', '-', '–', 'غائب', 'لا'].includes(v);
}

function findColumns(header: string[]): Partial<Record<Column, number>> {
  const keys = header.map(headerKey);
  const out: Partial<Record<Column, number>> = {};
  for (const col of Object.keys(SYNONYMS) as Column[]) {
    const i = keys.findIndex((k, idx) => (SYNONYMS[col] as readonly string[]).includes(k) && !Object.values(out).includes(idx));
    if (i >= 0) out[col] = i;
  }
  return out;
}

/** Normalises a person's name for matching: Unicode-folded, lowercased, single spaces. */
export function normaliseName(name: string | null | undefined): string {
  return (name ?? '')
    .normalize('NFKC')
    .toLowerCase()
    .replace(/[\u200e\u200f\u202a-\u202e]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

const round1 = (n: number) => Math.round(n * 10) / 10;

/**
 * Rows of a Meet attendance file (cells as text, the first sheet of an .xlsx or a .csv) →
 * one record per person. Rows without a name or an email, or with a duration that can't be
 * read, are reported and skipped; the rest still count.
 */
export function parseAttendanceSheet(table: string[][]): AttendanceSheetResult {
  const rows = table.map((r) => r.map((c) => (c ?? '').toString()));
  const fail = (code: AttendanceSheetErrorCode): AttendanceSheetResult => ({ format: null, records: [], errors: [{ row: 0, code }], headerRow: null });
  if (!rows.some((r) => r.some((c) => c.trim()))) return fail('EMPTY');

  // The header is the first of the top rows that names a person column (title rows come before it).
  let h = -1;
  let cols: Partial<Record<Column, number>> = {};
  for (let i = 0; i < Math.min(rows.length, 15); i++) {
    const c = findColumns(rows[i]!);
    const filled = rows[i]!.filter((x) => x.trim()).length;
    // A person column, and more than one heading (a lone "Participants" title row isn't a header).
    if ((c.name !== undefined || c.email !== undefined || c.firstName !== undefined) && filled >= 2) {
      h = i;
      cols = c;
      break;
    }
  }
  if (h < 0) return fail('NO_HEADER');
  const header = rows[h]!;
  const body = rows.slice(h + 1);
  if (body.length > MAX_ATTENDANCE_ROWS) return fail('TOO_MANY_ROWS');

  // How minutes are known: a duration column, joined/exited times, or snapshot columns.
  const used = new Set(Object.values(cols));
  const snapshots = header
    .map((cell, i) => ({ i, at: used.has(i) ? null : snapshotTime(cell) }))
    .filter((x): x is { i: number; at: number } => x.at !== null);
  let format: AttendanceFormat;
  let interval = 1;
  if (cols.duration !== undefined || (cols.joined !== undefined && cols.exited !== undefined)) {
    format = cols.firstName !== undefined && cols.lastName !== undefined ? 'workspace' : 'extension';
  } else if (snapshots.length) {
    format = 'snapshots';
    // Each mark stands for the gap between snapshots (the median, so one late snapshot doesn't skew it).
    const gaps = snapshots
      .slice(1)
      .map((s, k) => (s.at - snapshots[k]!.at) / 60_000)
      .filter((g) => g > 0)
      .sort((a, b) => a - b);
    interval = gaps.length ? gaps[Math.floor(gaps.length / 2)]! : 1;
  } else return fail('NO_DURATION');

  const errors: AttendanceSheetError[] = [];
  const byKey = new Map<string, AttendanceRecord>();
  const order: string[] = [];
  const cell = (r: string[], i: number | undefined) => (i === undefined ? '' : (r[i] ?? '').trim());
  body.forEach((r, k) => {
    const row = h + k + 2;
    if (!r.some((c) => c.trim())) return;
    const first = cell(r, cols.firstName);
    const last = cell(r, cols.lastName);
    const name = (cell(r, cols.name) || [first, last].filter(Boolean).join(' ')).replace(/\s+/g, ' ').trim();
    const rawEmail = cell(r, cols.email).toLowerCase();
    const email = /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(rawEmail) ? rawEmail : null;
    if (!name && !email) {
      errors.push({ row, code: 'NO_IDENTITY' });
      return;
    }
    let minutes: number | null;
    if (format === 'snapshots') minutes = snapshots.filter((s) => marked(r[s.i] ?? '')).length * interval;
    else {
      const d = cols.duration !== undefined ? cell(r, cols.duration) : '';
      minutes = d ? parseDuration(d) : clockMinutes(cell(r, cols.joined), cell(r, cols.exited));
      // A blank duration with join/leave times: work it out from those.
      if (minutes === null && d === '' && cols.joined !== undefined) minutes = clockMinutes(cell(r, cols.joined), cell(r, cols.exited));
    }
    if (minutes === null || !Number.isFinite(minutes) || minutes < 0) {
      errors.push({ row, code: 'BAD_DURATION' });
      return;
    }
    const key = email ? `e:${email}` : `n:${normaliseName(name)}`;
    const prev = byKey.get(key);
    if (prev) {
      prev.minutes += minutes;
      prev.rows.push(row);
      if (!prev.name && name) prev.name = name;
    } else {
      byKey.set(key, { name, email, minutes, rows: [row] });
      order.push(key);
    }
  });
  const records = order.map((k) => {
    const r = byKey.get(k)!;
    return { ...r, minutes: Math.min(MAX_ATTENDANCE_MINUTES, round1(r.minutes)) };
  });
  return { format, records, errors, headerRow: h + 1 };
}

// ------------------------------------------------------------------ matching

const GMAIL_DOMAINS = new Set(['gmail.com', 'googlemail.com']);

/**
 * The address Google delivers to. Only for gmail.com / googlemail.com, where Google ignores
 * dots and anything after "+" in the local part (so a.b+meet@gmail.com is ab@gmail.com).
 * Other domains (Workspace, Outlook…) are left alone: there those can be different people.
 */
export function canonicalEmail(email: string | null | undefined): string {
  const e = (email ?? '').trim().toLowerCase();
  const at = e.lastIndexOf('@');
  if (at < 1) return e;
  const domain = e.slice(at + 1);
  if (!GMAIL_DOMAINS.has(domain)) return e;
  const local = e.slice(0, at).split('+')[0]!.replace(/\./g, '');
  return `${local}@gmail.com`;
}

export type AttendanceMatch = 'EMAIL' | 'NAME' | 'MANUAL';

export interface MatchCandidate {
  userId: string;
  /** The account email and the Google account email from the profile, if different. */
  emails: string[];
  /** Full names (English profile name first). */
  names: string[];
}

/**
 * Who each record is: by email first (exactly, then Gmail-canonical, never two students for
 * one address), else by exact full name when exactly one enrolled student has it (flagged
 * NAME for review). Unmatched records get null: they are listed for the uploader, never saved.
 */
export function matchAttendance(records: Pick<AttendanceRecord, 'name' | 'email'>[], students: MatchCandidate[]): ({ userId: string; by: AttendanceMatch } | null)[] {
  const exact = new Map<string, Set<string>>();
  const canonical = new Map<string, Set<string>>();
  const named = new Map<string, Set<string>>();
  const add = (m: Map<string, Set<string>>, k: string, id: string) => {
    if (!k) return;
    const s = m.get(k) ?? new Set<string>();
    s.add(id);
    m.set(k, s);
  };
  for (const s of students) {
    for (const e of s.emails) {
      add(exact, e.trim().toLowerCase(), s.userId);
      add(canonical, canonicalEmail(e), s.userId);
    }
    for (const n of s.names) add(named, normaliseName(n), s.userId);
  }
  const one = (set: Set<string> | undefined) => (set && set.size === 1 ? [...set][0]! : null);
  return records.map((r) => {
    if (r.email) {
      const id = one(exact.get(r.email.trim().toLowerCase())) ?? one(canonical.get(canonicalEmail(r.email)));
      if (id) return { userId: id, by: 'EMAIL' as const };
    }
    const n = normaliseName(r.name);
    const id = n ? one(named.get(n)) : null;
    return id ? { userId: id, by: 'NAME' as const } : null;
  });
}

// ------------------------------------------------------------------ requests

const recordSchema = z.object({
  name: z.string().trim().max(200).default(''),
  email: z
    .string()
    .trim()
    .toLowerCase()
    .max(254)
    .nullish()
    .transform((v) => v || null),
  minutes: z.number().min(0).max(MAX_ATTENDANCE_MINUTES),
});

/**
 * One upload: the records read from the file, the uploader's choices from the preview (rows
 * matched by hand, rows ignored, students marked by hand), and an optional threshold for this
 * session only. `dryRun` (the default) returns the preview and saves nothing.
 */
export const attendanceUploadSchema = z.object({
  records: z.array(recordSchema).max(MAX_ATTENDANCE_ROWS),
  presentPercent: z.number().int().min(1).max(100).nullish(),
  /** Unmatched (or wrongly matched) records → an enrolled student, by record index. */
  assign: z.array(z.object({ index: z.number().int().min(0), userId: z.string().trim().min(1).max(40) })).max(MAX_ATTENDANCE_ROWS).default([]),
  /** Records to leave out, by index (a guest, a wrong name match). */
  ignore: z.array(z.number().int().min(0)).max(MAX_ATTENDANCE_ROWS).default([]),
  /** Students marked by hand in the preview: the file's minutes stay, the status is this one. */
  statuses: z.array(z.object({ userId: z.string().trim().min(1).max(40), status: z.enum(ATTENDANCE_STATUSES) })).max(5000).default([]),
  dryRun: z.boolean().default(true),
});
export type AttendanceUploadInput = z.infer<typeof attendanceUploadSchema>;

/** Marking one student by hand after the upload (or without one). */
export const attendanceMarkSchema = z.object({ status: z.enum(ATTENDANCE_STATUSES) });
export type AttendanceMarkInput = z.infer<typeof attendanceMarkSchema>;

// ------------------------------------------------------------------ responses

export interface AttendanceSessionRefDto {
  id: string;
  order: number;
  titleEn: string;
  titleAr: string;
  startsAt: string;
  durationMin: number;
}

export interface AttendanceRowDto {
  userId: string;
  name: string | null;
  email: string;
  minutes: number;
  percent: number;
  status: AttendanceStatus;
  source: AttendanceSource;
  /** How the file's row was matched; null for a student who wasn't in the file. */
  matchedBy: AttendanceMatch | null;
  /** The attendance points this status is worth now. */
  points: number;
  /** What saving changes in the ledger (0 = nothing; negative takes points back). */
  change: number;
  /** Indexes of the uploaded records counted for this student (preview only). */
  records: number[];
}

export interface AttendanceSessionDto {
  session: AttendanceSessionRefDto;
  settings: AttendanceSettings;
  /** The threshold used (the course's, or this upload's override). */
  presentPercent: number;
  /** One row per enrolled student; empty until attendance is recorded. */
  rows: AttendanceRowDto[];
  recorded: boolean;
  updatedAt: string | null;
  counts: { present: number; partial: number; absent: number };
}

export interface AttendancePreviewDto extends AttendanceSessionDto {
  dryRun: boolean;
  /** Records nobody matched (and that weren't ignored): pick a student or ignore them. */
  unmatched: { index: number; name: string; email: string | null; minutes: number }[];
  ignored: number;
  /** Points added minus points taken back by saving. */
  pointsChange: number;
}

export interface AttendanceCourseDto {
  settings: AttendanceSettings;
  /** Enrolled students who can be matched by hand. */
  students: { userId: string; name: string | null; email: string }[];
  sessions: (AttendanceSessionRefDto & { recorded: boolean; present: number; partial: number; absent: number; updatedAt: string | null })[];
}

/** The learn page: a student's own attendance at one session. */
export interface MyAttendanceDto {
  status: AttendanceStatus;
  minutes: number;
  percent: number;
}
