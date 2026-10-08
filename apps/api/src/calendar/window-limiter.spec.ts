import { WindowLimiter } from './window-limiter';

describe('WindowLimiter', () => {
  it('allows up to the limit per key and window, then resets', () => {
    const l = new WindowLimiter(2, 1000);
    expect([l.hit('a', 0), l.hit('a', 10), l.hit('a', 20)]).toEqual([true, true, false]);
    expect(l.exhausted('a', 30)).toBe(true);
    expect(l.hit('b', 30)).toBe(true);
    expect(l.exhausted('a', 1000)).toBe(false);
    expect(l.hit('a', 1000)).toBe(true);
  });

  it('stays bounded under many distinct keys', () => {
    const l = new WindowLimiter(1, 1000, 3);
    for (const k of ['a', 'b', 'c', 'd', 'e']) l.hit(k, 0);
    expect(l.hit('e', 0)).toBe(false);
  });
});
