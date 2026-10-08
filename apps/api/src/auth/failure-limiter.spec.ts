import { FailureLimiter } from './failure-limiter';

describe('FailureLimiter', () => {
  it('locks a key after max failures within the window, then forgets them', () => {
    const l = new FailureLimiter(3, 1000);
    for (let i = 0; i < 3; i++) l.fail('a@x.test', 100 + i);
    expect(() => l.check('a@x.test', 200)).toThrow(/Too many/);
    expect(() => l.check('b@x.test', 200)).not.toThrow();
    expect(() => l.check('a@x.test', 2000)).not.toThrow();
  });
  it('resets on success', () => {
    const l = new FailureLimiter(1, 1000);
    l.fail('a', 0);
    l.reset('a');
    expect(() => l.check('a', 1)).not.toThrow();
  });
});
