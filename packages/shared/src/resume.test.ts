import { describe, expect, it } from 'vitest';
import { formatVideoTime, lessonPositionSchema, resumeStart, stoppedAtFromResume } from './resume';

describe('resumeStart', () => {
  it('resumes 3 seconds before where they stopped, in whole seconds', () => {
    expect(resumeStart(2530, 3600, false)).toBe(2527);
    expect(resumeStart(100.9, null, false)).toBe(97);
    expect(resumeStart(5, 600, false)).toBe(2);
  });

  it('starts at the beginning when the lesson is completed', () => {
    expect(resumeStart(2530, 3600, true)).toBe(0);
  });

  it('starts at the beginning within 10 seconds of the end', () => {
    expect(resumeStart(3590, 3600, false)).toBe(0);
    expect(resumeStart(3600, 3600, false)).toBe(0);
    expect(resumeStart(3589, 3600, false)).toBe(3586);
  });

  it('starts at the beginning under 5 seconds in, or on nonsense', () => {
    expect(resumeStart(0, 600, false)).toBe(0);
    expect(resumeStart(4.9, 600, false)).toBe(0);
    expect(resumeStart(Number.NaN, 600, false)).toBe(0);
    expect(resumeStart(-20, 600, false)).toBe(0);
  });

  it('ignores an unknown duration', () => {
    expect(resumeStart(500, undefined, false)).toBe(497);
    expect(resumeStart(500, 0, false)).toBe(497);
  });
});

describe('lessonPositionSchema', () => {
  it('takes whole seconds up to a day, the duration optional', () => {
    expect(lessonPositionSchema.parse({ positionSec: 0 })).toEqual({ positionSec: 0 });
    expect(lessonPositionSchema.parse({ positionSec: 86_400, durationSec: 86_400 })).toEqual({ positionSec: 86_400, durationSec: 86_400 });
  });
  it.each([
    { positionSec: -1 },
    { positionSec: 86_401 },
    { positionSec: 1.5 },
    { positionSec: '10' },
    { positionSec: 10, durationSec: 0 },
    { positionSec: 10, durationSec: 86_401 },
    { positionSec: 10, completed: true },
    {},
  ])('refuses %j', (body) => {
    expect(lessonPositionSchema.safeParse(body).success).toBe(false);
  });
});

describe('formatVideoTime', () => {
  it('writes m:ss under an hour and h:mm:ss from an hour', () => {
    expect(formatVideoTime(0)).toBe('0:00');
    expect(formatVideoTime(9)).toBe('0:09');
    expect(formatVideoTime(2530)).toBe('42:10');
    expect(formatVideoTime(3599.9)).toBe('59:59');
    expect(formatVideoTime(3600)).toBe('1:00:00');
    expect(formatVideoTime(3725)).toBe('1:02:05');
    expect(formatVideoTime(-5)).toBe('0:00');
  });
});

describe('stoppedAtFromResume', () => {
  it('undoes the overlap, for every position that resumes', () => {
    for (const pos of [5, 6, 99, 2530, 86_000]) expect(stoppedAtFromResume(resumeStart(pos, null, false))).toBe(pos);
    expect(stoppedAtFromResume(0)).toBe(0);
    expect(stoppedAtFromResume(null)).toBe(0);
  });
});
