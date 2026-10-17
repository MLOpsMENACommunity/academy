import { describe, expect, it } from 'vitest';
import { MAX_ATTEMPTS, recordForward } from './forward';
import { isAuthPage } from './use-return-to';

function memoryStorage(): Storage {
  const data = new Map<string, string>();
  return {
    get length() {
      return data.size;
    },
    clear: () => data.clear(),
    getItem: (k) => data.get(k) ?? null,
    key: (i) => [...data.keys()][i] ?? null,
    removeItem: (k) => void data.delete(k),
    setItem: (k, v) => void data.set(k, v),
  };
}

describe('recordForward (login loop guard)', () => {
  it(`allows ${MAX_ATTEMPTS} attempts at the same target, then stops`, () => {
    const s = memoryStorage();
    for (let i = 0; i < MAX_ATTEMPTS; i++) expect(recordForward('/en/dashboard', s, 1000 + i)).toBe(true);
    expect(recordForward('/en/dashboard', s, 1000 + MAX_ATTEMPTS)).toBe(false);
  });

  it('starts over for another target or after the window', () => {
    const s = memoryStorage();
    for (let i = 0; i < MAX_ATTEMPTS; i++) recordForward('/en/dashboard', s, 1000);
    expect(recordForward('/en/admin', s, 1000)).toBe(true);
    for (let i = 0; i < MAX_ATTEMPTS; i++) recordForward('/en/dashboard', s, 2000);
    expect(recordForward('/en/dashboard', s, 2000 + 60_000)).toBe(true);
  });

  it('never blocks without storage or with garbage in it', () => {
    expect(recordForward('/en/dashboard', null)).toBe(true);
    const s = memoryStorage();
    s.setItem('academy.forward', '{not json');
    expect(recordForward('/en/dashboard', s)).toBe(true);
  });
});

describe('isAuthPage (never a returnTo after signing in)', () => {
  it('matches the sign-in pages in either language', () => {
    for (const p of ['/en/login', '/ar/login?returnTo=%2Fen%2Fdashboard', '/en/register', '/login', '/ar/forgot-password', '/en/reset-password#t=x']) {
      expect(isAuthPage(p), p).toBe(true);
    }
  });
  it('leaves other pages alone', () => {
    for (const p of ['/en/dashboard', '/en/courses/login-basics', '/ar/learn/mlops#session-3-feedback', '/en/loginx', '/en/verify-email']) {
      expect(isAuthPage(p), p).toBe(false);
    }
  });
});
