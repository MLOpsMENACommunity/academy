import { nextReminderAfter } from './study-plan.jobs';

// Cairo is UTC+2 in November 2026 (no DST). 2026-11-17 is a Tuesday (weekday 2).
const plan = { weekdays: [0, 2, 4], reminderHour: 20, startDate: '2026-11-01' };

describe('nextReminderAfter (feeds the jobs tick nextDueAt)', () => {
  it('is today at the reminder hour when that is still ahead', () => {
    expect(nextReminderAfter(plan, 'Africa/Cairo', new Date('2026-11-17T10:00:00Z'))?.toISOString()).toBe('2026-11-17T18:00:00.000Z');
  });
  it('moves to the next study day once today’s time has passed', () => {
    expect(nextReminderAfter(plan, 'Africa/Cairo', new Date('2026-11-17T18:00:01Z'))?.toISOString()).toBe('2026-11-19T18:00:00.000Z');
  });
  it('never comes before the plan starts', () => {
    expect(nextReminderAfter({ ...plan, startDate: '2026-11-22' }, 'Africa/Cairo', new Date('2026-11-17T10:00:00Z'))?.toISOString()).toBe('2026-11-22T18:00:00.000Z');
  });
  it('uses the student’s own time zone', () => {
    expect(nextReminderAfter(plan, 'UTC', new Date('2026-11-17T10:00:00Z'))?.toISOString()).toBe('2026-11-17T20:00:00.000Z');
  });
});
