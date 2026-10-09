import { describe, expect, it } from 'vitest';
import { FUNNEL_EVENTS } from './enums';
import { funnelBars } from './funnel';

describe('funnelBars (QA M6: no percentage above 100%)', () => {
  // The staging numbers from the QA report: later steps hold more people than earlier ones.
  const staging = {
    COURSE_VIEW: 0,
    APPLY_CLICKED: 6,
    REGISTERED: 1,
    PROFILE_COMPLETED: 2,
    APPLICATION_SUBMITTED: 3,
  };

  it('gives every step its own count, in funnel order', () => {
    const bars = funnelBars(staging);
    expect(bars.map((b) => b.event)).toEqual([...FUNNEL_EVENTS]);
    expect(bars.find((b) => b.event === 'PROFILE_COMPLETED')?.count).toBe(2);
    expect(bars.find((b) => b.event === 'ENROLLED')?.count).toBe(0);
  });

  it('never reports a share above 100%, and no step-to-step conversion', () => {
    const bars = funnelBars(staging);
    for (const b of bars) {
      expect(b.width).toBeGreaterThanOrEqual(0);
      expect(b.width).toBeLessThanOrEqual(100);
      expect(Object.keys(b).sort()).toEqual(['count', 'event', 'width']);
    }
    expect(bars.find((b) => b.event === 'APPLY_CLICKED')?.width).toBe(100);
  });

  it('handles an empty funnel', () => {
    expect(funnelBars({}).every((b) => b.count === 0 && b.width === 0)).toBe(true);
  });
});
