import { describe, expect, it } from 'vitest';
import { IDLE_MS, isIdle, shouldPoll } from './bell-poll';

describe('shouldPoll', () => {
  const now = 1_000_000_000;
  it('polls a visible tab someone used recently', () => {
    expect(shouldPoll(true, now - 1_000, now)).toBe(true);
    expect(shouldPoll(true, now - IDLE_MS + 1, now)).toBe(true);
  });
  it('stops for a hidden tab', () => {
    expect(shouldPoll(false, now, now)).toBe(false);
  });
  it('stops for a tab nobody has touched for IDLE_MS', () => {
    expect(isIdle(now - IDLE_MS, now)).toBe(true);
    expect(shouldPoll(true, now - IDLE_MS, now)).toBe(false);
    expect(shouldPoll(true, now - 3 * IDLE_MS, now)).toBe(false);
  });
});
