import { describe, expect, it } from 'vitest';
import {
  addDays,
  localIsoDate,
  nextStudyDate,
  planSchedule,
  STUDY_PLAN_QUIZ_MINUTES,
  studyPlanSchema,
  weekdayOf,
  type StudyItem,
} from './study-plan';

const lesson = (id: string, minutes: number, done = false): StudyItem => ({ id, kind: 'lesson', minutes, done });
const quiz = (id: string, done = false): StudyItem => ({ id, kind: 'quiz', minutes: STUDY_PLAN_QUIZ_MINUTES, done });
// 2026-11-15 is a Sunday.
const SUN = '2026-11-15';
const SUN_TUE_THU = [0, 2, 4];

const ids = (s: ReturnType<typeof planSchedule>) => s.days.map((d) => [d.date, d.items.map((i) => (i.parts > 1 ? `${i.id}(${i.part}/${i.parts})` : i.id))]);

describe('dates', () => {
  it('weekday, adding days and the next study date', () => {
    expect(weekdayOf(SUN)).toBe(0);
    expect(weekdayOf('2026-11-21')).toBe(6);
    expect(addDays('2026-12-30', 3)).toBe('2027-01-02');
    expect(addDays('2026-03-01', -1)).toBe('2026-02-28');
    expect(nextStudyDate('2026-11-16', SUN_TUE_THU)).toBe('2026-11-17');
    expect(nextStudyDate('2026-11-20', SUN_TUE_THU)).toBe('2026-11-22');
    expect(nextStudyDate(SUN, SUN_TUE_THU)).toBe(SUN);
  });

  it('the local date in a time zone', () => {
    // 23:30 UTC on the 15th is already the 16th in Cairo (UTC+2) and still the 15th in New York.
    const at = new Date('2026-11-15T23:30:00Z');
    expect(localIsoDate(at, 'Africa/Cairo')).toBe('2026-11-16');
    expect(localIsoDate(at, 'America/New_York')).toBe('2026-11-15');
  });
});

describe('planSchedule', () => {
  it('packs items in course order up to the minutes per day', () => {
    const s = planSchedule({
      items: [lesson('v1', 20), lesson('v2', 20), quiz('q1'), lesson('v3', 40), lesson('v4', 10)],
      weekdays: SUN_TUE_THU,
      minutesPerDay: 45,
      startDate: SUN,
      today: SUN,
    });
    // v1+v2 = 40; the quiz (20) doesn't fit what is left of Sunday, so it opens Tuesday.
    expect(ids(s)).toEqual([
      ['2026-11-15', ['v1', 'v2']],
      ['2026-11-17', ['q1']],
      ['2026-11-19', ['v3']],
      ['2026-11-22', ['v4']],
    ]);
    expect(s.days[0]!.minutes).toBe(40);
    expect(s.targetDate).toBe('2026-11-22');
    expect(s.totalItems).toBe(5);
    expect(s.remainingItems).toBe(5);
  });

  it('an item longer than a day takes consecutive study days, and the last day is shared', () => {
    const s = planSchedule({ items: [lesson('v1', 10), lesson('long', 100), lesson('v2', 15)], weekdays: SUN_TUE_THU, minutesPerDay: 45, startDate: SUN, today: SUN });
    expect(ids(s)).toEqual([
      ['2026-11-15', ['v1']],
      ['2026-11-17', ['long(1/3)']],
      ['2026-11-19', ['long(2/3)']],
      ['2026-11-22', ['long(3/3)', 'v2']],
    ]);
    expect(s.days.map((d) => d.minutes)).toEqual([10, 45, 45, 25]);
  });

  it('skips done items', () => {
    const s = planSchedule({ items: [lesson('v1', 30, true), lesson('v2', 30), quiz('q1', true), lesson('v3', 30)], weekdays: [1], minutesPerDay: 60, startDate: SUN, today: SUN });
    expect(ids(s)).toEqual([['2026-11-16', ['v2', 'v3']]]);
    expect(s.remainingItems).toBe(2);
  });

  it('wraps over the end of the week and the year', () => {
    const s = planSchedule({ items: [lesson('a', 60), lesson('b', 60), lesson('c', 60)], weekdays: [5, 6], minutesPerDay: 60, startDate: '2026-12-25', today: '2026-12-25' });
    // 25 Dec 2026 is a Friday.
    expect(ids(s)).toEqual([
      ['2026-12-25', ['a']],
      ['2026-12-26', ['b']],
      ['2027-01-01', ['c']],
    ]);
  });

  it('never schedules a day in the past, and waits for a start date in the future', () => {
    const past = planSchedule({ items: [lesson('a', 30), lesson('b', 30)], weekdays: SUN_TUE_THU, minutesPerDay: 30, startDate: '2026-11-01', today: '2026-11-18' });
    expect(past.days[0]!.date).toBe('2026-11-19');
    expect(past.days.every((d) => d.date >= '2026-11-18')).toBe(true);
    const future = planSchedule({ items: [lesson('a', 30)], weekdays: SUN_TUE_THU, minutesPerDay: 30, startDate: '2026-12-01', today: SUN });
    expect(future.days[0]!.date).toBe('2026-12-01');
  });

  it('has no target date when everything is done', () => {
    const s = planSchedule({ items: [lesson('a', 30, true)], weekdays: [0], minutesPerDay: 30, startDate: SUN, today: SUN });
    expect(s.days).toEqual([]);
    expect(s.targetDate).toBeNull();
    expect(s.status(SUN, 1)).toEqual({ onTrack: true, behindBy: 0, expected: 0 });
  });

  it('on track or behind, against the plan from its start date', () => {
    const items = [lesson('a', 30), lesson('b', 30), quiz('q'), lesson('c', 30)];
    const rules = { weekdays: SUN_TUE_THU, minutesPerDay: 30, startDate: SUN };
    // The plan: a Sun 15, b Tue 17, q Thu 19, c Sun 22.
    const s = planSchedule({ ...rules, items, today: '2026-11-20' });
    // Before the 20th: a, b and q were due.
    expect(s.status('2026-11-20', 3)).toEqual({ onTrack: true, behindBy: 0, expected: 3 });
    expect(s.status('2026-11-20', 1)).toEqual({ onTrack: false, behindBy: 2, expected: 3 });
    // Today's items are not late yet.
    expect(s.status('2026-11-17', 1)).toEqual({ onTrack: true, behindBy: 0, expected: 1 });
    // Ahead of the plan is on track.
    expect(s.status(SUN, 2).onTrack).toBe(true);
    // Before the start date nothing is due.
    expect(s.status('2026-11-01', 0)).toEqual({ onTrack: true, behindBy: 0, expected: 0 });
  });
});

describe('studyPlanSchema', () => {
  const ok = { weekdays: [4, 0, 2], minutesPerDay: 45, startDate: '2026-11-16', reminderHour: 20 };
  it('accepts a plan and sorts the weekdays', () => {
    expect(studyPlanSchema.parse(ok).weekdays).toEqual([0, 2, 4]);
    expect(studyPlanSchema.parse({ ...ok, reminderHour: null }).reminderHour).toBeNull();
  });
  it.each([
    { weekdays: [] },
    { weekdays: [7] },
    { weekdays: [1, 1] },
    { minutesPerDay: 10 },
    { minutesPerDay: 241 },
    { minutesPerDay: 30.5 },
    { startDate: '2026-02-30' },
    { startDate: '16/11/2026' },
    { reminderHour: 24 },
    { reminderHour: -1 },
  ])('rejects %o', (bad) => {
    expect(studyPlanSchema.safeParse({ ...ok, ...bad }).success).toBe(false);
  });
});
