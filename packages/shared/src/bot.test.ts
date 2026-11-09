import { describe, expect, it } from 'vitest';
import { botActivityKind, botActivityQuerySchema, practicalTaskDeadline } from './bot';

describe('botActivityKind', () => {
  it('splits quizzes by whether they belong to a session', () => {
    expect(botActivityKind('QUIZ', true)).toBe('WEEKLY_QUIZ');
    expect(botActivityKind('QUIZ', false)).toBe('MIDPOINT_QUIZ');
  });
  it('counts session labs and assignments, and ignores course-level ones', () => {
    expect(botActivityKind('LAB', true)).toBe('PRACTICAL_TASK');
    expect(botActivityKind('ASSIGNMENT', true)).toBe('PRACTICAL_TASK');
    expect(botActivityKind('LAB', false)).toBeNull();
  });
});

describe('practicalTaskDeadline', () => {
  const day = (d: number) => new Date(Date.UTC(2026, 10, d));
  it('is the next session of the course', () => {
    expect(practicalTaskDeadline(day(2), [day(16), day(2), day(9)], day(30))).toEqual(day(9));
  });
  it('falls back to the due date after the last session, then to none', () => {
    expect(practicalTaskDeadline(day(16), [day(2), day(16)], day(30))).toEqual(day(30));
    expect(practicalTaskDeadline(day(16), [day(16)], null)).toBeNull();
  });
});

describe('botActivityQuerySchema', () => {
  it('needs a window that runs forwards and is not too long', () => {
    expect(botActivityQuerySchema.safeParse({ from: '2026-01-01', to: '2026-02-01' }).success).toBe(true);
    expect(botActivityQuerySchema.safeParse({ from: '2026-02-01', to: '2026-01-01' }).success).toBe(false);
    expect(botActivityQuerySchema.safeParse({ from: '2025-01-01', to: '2026-02-01' }).success).toBe(false);
    expect(botActivityQuerySchema.safeParse({}).success).toBe(false);
  });
});
