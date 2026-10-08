import { describe, expect, it } from 'vitest';
import { weeklyDates } from './CourseTabs';

describe('weeklyDates', () => {
  it('keeps the local time every week and skips break weeks', () => {
    const dates = weeklyDates('2026-10-18T19:00', 6, [4]);
    expect(dates).toHaveLength(6);
    // Same wall-clock time in the admin's zone, whatever the DST change in between.
    expect(dates.every((d) => d.getHours() === 19 && d.getMinutes() === 0)).toBe(true);
    const days = dates.map((d) => `${d.getMonth() + 1}/${d.getDate()}`);
    expect(days).toEqual(['10/18', '10/25', '11/1', '11/15', '11/22', '11/29']);
  });
});
