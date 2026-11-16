import { z } from 'zod';
import { localDay } from './consultations';

/**
 * Study plans for self-paced courses: the student picks study weekdays, minutes per day, a start
 * date and an optional reminder hour, and the remaining required lessons and mandatory quizzes are
 * packed onto those days in course order. Everything here is pure: callers pass `today` (a
 * calendar date in the student's time zone), nothing reads the clock.
 *
 * Dates are calendar dates as 'YYYY-MM-DD' strings (no time zone); weekdays are 0 = Sunday … 6 = Saturday.
 */

/** How long a quiz (any mandatory assessment) counts for in a plan. */
export const STUDY_PLAN_QUIZ_MINUTES = 20;
export const STUDY_PLAN_MIN_MINUTES = 15;
export const STUDY_PLAN_MAX_MINUTES = 240;
/** The choices the form offers (the API accepts any whole number in range). */
export const STUDY_PLAN_MINUTE_OPTIONS = [15, 30, 45, 60, 90, 120, 180, 240] as const;
/** When a study block starts in the calendar feed if the plan has no reminder hour. */
export const STUDY_PLAN_CALENDAR_HOUR = 19;
/** The calendar feed shows study blocks this many weeks ahead. */
export const STUDY_PLAN_CALENDAR_WEEKS = 8;
/** A reminder more than this many hours late (e.g. after a missed tick) is dropped for the day. */
export const STUDY_PLAN_REMINDER_WINDOW_HOURS = 3;

const ISO_DATE = /^(\d{4})-(\d{2})-(\d{2})$/;
const DAY_MS = 86_400_000;

/** Days since 1970-01-01 for a valid 'YYYY-MM-DD', else null. */
function dayNumber(date: string): number | null {
  const m = ISO_DATE.exec(date);
  if (!m) return null;
  const [y, mo, d] = [Number(m[1]), Number(m[2]), Number(m[3])];
  const t = Date.UTC(y, mo - 1, d);
  const back = new Date(t);
  if (back.getUTCFullYear() !== y || back.getUTCMonth() !== mo - 1 || back.getUTCDate() !== d) return null;
  return t / DAY_MS;
}

const fromDayNumber = (n: number) => new Date(n * DAY_MS).toISOString().slice(0, 10);

export function isIsoDate(date: string): boolean {
  return dayNumber(date) !== null;
}

/** The date `n` days after (or before, if negative) a 'YYYY-MM-DD' date. */
export function addDays(date: string, n: number): string {
  const d = dayNumber(date);
  if (d === null) throw new Error(`Not a date: ${date}`);
  return fromDayNumber(d + n);
}

/** 0 = Sunday … 6 = Saturday. */
export function weekdayOf(date: string): number {
  const d = dayNumber(date);
  if (d === null) throw new Error(`Not a date: ${date}`);
  // 1970-01-01 was a Thursday.
  return (((d + 4) % 7) + 7) % 7;
}

/** The calendar date an instant falls on in a time zone, as 'YYYY-MM-DD'. */
export function localIsoDate(at: Date, timezone: string): string {
  const d = localDay(at, timezone);
  return `${d.year}-${String(d.month).padStart(2, '0')}-${String(d.day).padStart(2, '0')}`;
}

export const studyPlanSchema = z.object({
  weekdays: z
    .array(z.number().int().min(0).max(6))
    .min(1)
    .max(7)
    .refine((w) => new Set(w).size === w.length, 'Each day once')
    .transform((w) => [...w].sort((a, b) => a - b)),
  minutesPerDay: z.number().int().min(STUDY_PLAN_MIN_MINUTES).max(STUDY_PLAN_MAX_MINUTES),
  startDate: z
    .string()
    .refine(isIsoDate, 'Use a date like 2026-11-16')
    .refine((d) => d >= '2024-01-01' && d <= '2100-12-31', 'Use a date like 2026-11-16'),
  /** In the student's time zone; null for no reminder. */
  reminderHour: z.number().int().min(0).max(23).nullable(),
});
export type StudyPlanInput = z.infer<typeof studyPlanSchema>;

export type StudyItemKind = 'lesson' | 'quiz';

/** A required lesson (its video length) or a mandatory quiz, in course order. */
export interface StudyItem {
  id: string;
  kind: StudyItemKind;
  minutes: number;
  done: boolean;
}

/** An item on a study day. An item longer than a day is split into parts on consecutive study days. */
export interface StudyDayItem {
  id: string;
  kind: StudyItemKind;
  /** Minutes of this item on this day. */
  minutes: number;
  /** 1-based; `parts` is 1 unless the item spans days. */
  part: number;
  parts: number;
}

export interface StudyDay {
  date: string;
  weekday: number;
  minutes: number;
  items: StudyDayItem[];
}

export interface StudyPlanRules {
  weekdays: readonly number[];
  minutesPerDay: number;
  startDate: string;
}

export interface StudyPlanStatus {
  onTrack: boolean;
  /** Items the plan expected done before today that aren't (0 when on track). */
  behindBy: number;
  /** Items the plan expected done before today. */
  expected: number;
}

export interface StudySchedule {
  /** Study days from today (or the start date, if later) with the items not done yet, in order. */
  days: StudyDay[];
  /** The last study day, or null when nothing is left. */
  targetDate: string | null;
  totalItems: number;
  remainingItems: number;
  /** Against the plan laid out from its start date with every item: is the student keeping up? */
  status: (today: string, completedCount: number) => StudyPlanStatus;
}

/** The first study date on or after `date`. */
export function nextStudyDate(date: string, weekdays: readonly number[]): string {
  if (!weekdays.length) throw new Error('A plan needs at least one study day');
  let d = date;
  for (let i = 0; i < 7; i++) {
    if (weekdays.includes(weekdayOf(d))) return d;
    d = addDays(d, 1);
  }
  throw new Error('Unreachable: no study weekday in a week');
}

/** Packs items in order onto study days from `from`, up to minutesPerDay each. */
function pack(items: readonly StudyItem[], rules: StudyPlanRules, from: string): StudyDay[] {
  const cap = Math.max(1, Math.round(rules.minutesPerDay));
  const days: StudyDay[] = [];
  let day: StudyDay | null = null;
  const open = (): StudyDay => {
    const date: string = day ? nextStudyDate(addDays(day.date, 1), rules.weekdays) : nextStudyDate(from, rules.weekdays);
    day = { date, weekday: weekdayOf(date), minutes: 0, items: [] };
    days.push(day);
    return day;
  };
  for (const item of items) {
    const minutes = Math.max(1, Math.round(item.minutes));
    let current: StudyDay = day ?? open();
    // An item that doesn't fit what is left of the day starts the next study day.
    if (current.minutes > 0 && current.minutes + minutes > cap) current = open();
    if (minutes <= cap - current.minutes) {
      current.items.push({ id: item.id, kind: item.kind, minutes, part: 1, parts: 1 });
      current.minutes += minutes;
      continue;
    }
    // Longer than a whole day (the day is empty here): consecutive study days, the rest of the last one stays free.
    const parts = Math.ceil(minutes / cap);
    let left = minutes;
    for (let part = 1; part <= parts; part++) {
      if (part > 1) current = open();
      const m = Math.min(cap, left);
      current.items.push({ id: item.id, kind: item.kind, minutes: m, part, parts });
      current.minutes += m;
      left -= m;
    }
  }
  return days;
}

/**
 * Lays out the items not done yet from today (never on a past day), or from the start date if
 * it is later. `status` compares progress with the same plan laid out from its start date with
 * every item, done or not: an item is expected done once its last study day is before today.
 */
export function planSchedule(input: StudyPlanRules & { items: readonly StudyItem[]; today: string }): StudySchedule {
  const { items, today } = input;
  if (!isIsoDate(today) || !isIsoDate(input.startDate)) throw new Error('planSchedule needs YYYY-MM-DD dates');
  const remaining = items.filter((i) => !i.done);
  const from = input.startDate > today ? input.startDate : today;
  const days = remaining.length ? pack(remaining, input, from) : [];
  let baseline: StudyDay[] | null = null;
  return {
    days,
    targetDate: days.length ? days[days.length - 1]!.date : null,
    totalItems: items.length,
    remainingItems: remaining.length,
    status(day: string, completedCount: number): StudyPlanStatus {
      baseline ??= pack(items, input, input.startDate);
      const lastDay = new Map<string, string>();
      for (const d of baseline) for (const it of d.items) lastDay.set(it.id, d.date);
      const expected = [...lastDay.values()].filter((date) => date < day).length;
      const behindBy = Math.max(0, expected - Math.max(0, completedCount));
      return { onTrack: behindBy === 0, behindBy, expected };
    },
  };
}

// ------------------------------------------------------------------ API shapes

export interface StudyPlanItemDto {
  id: string;
  kind: StudyItemKind;
  titleEn: string;
  titleAr: string;
  minutes: number;
  part: number;
  parts: number;
}

export interface StudyPlanDto {
  /** The student's time zone (from the profile; Africa/Cairo when not set). Reminder hours use it. */
  timezone: string;
  /** True when the profile has no time zone and the academy's (Africa/Cairo) is used. */
  timezoneIsDefault: boolean;
  plan: (StudyPlanInput & { updatedAt: string }) | null;
  summary: {
    /** The next study day (today if it is one) and what to do then; null when everything is done. */
    nextDay: { date: string; minutes: number; items: StudyPlanItemDto[] } | null;
    targetDate: string | null;
    onTrack: boolean;
    behindBy: number;
    totalItems: number;
    remainingItems: number;
  } | null;
}
