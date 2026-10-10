import { describe, expect, it } from 'vitest';
import { allowLookup } from './lookup-limiter';

describe('allowLookup', () => {
  it('allows 30 lookups a minute per visitor, then refuses until the window moves on', () => {
    const t0 = 1_000_000;
    for (let i = 0; i < 30; i++) expect(allowLookup('203.0.113.7', t0 + i)).toBe(true);
    expect(allowLookup('203.0.113.7', t0 + 100)).toBe(false);
    // Another visitor is unaffected.
    expect(allowLookup('198.51.100.1', t0 + 100)).toBe(true);
    expect(allowLookup('203.0.113.7', t0 + 60_000)).toBe(true);
  });

  it('never blocks when the address is unknown (local runs)', () => {
    for (let i = 0; i < 100; i++) expect(allowLookup(null)).toBe(true);
  });
});
