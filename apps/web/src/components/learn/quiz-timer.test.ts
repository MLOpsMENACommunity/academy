import { describe, expect, it } from 'vitest';
import { shouldAutoSubmit } from './quiz-timer';

describe('shouldAutoSubmit', () => {
  const base = { remaining: 0, restored: true, submitted: false, tried: false };
  it('submits once when time is up', () => {
    expect(shouldAutoSubmit(base)).toBe(true);
    expect(shouldAutoSubmit({ ...base, remaining: -5_000 })).toBe(true);
    expect(shouldAutoSubmit({ ...base, tried: true })).toBe(false);
    expect(shouldAutoSubmit({ ...base, submitted: true })).toBe(false);
  });
  it('never before time is up, or without a time limit', () => {
    expect(shouldAutoSubmit({ ...base, remaining: 1 })).toBe(false);
    expect(shouldAutoSubmit({ ...base, remaining: null })).toBe(false);
  });
  it('waits for the saved answers (a reload in the grace period must not submit an empty attempt)', () => {
    expect(shouldAutoSubmit({ ...base, restored: false })).toBe(false);
  });
});
