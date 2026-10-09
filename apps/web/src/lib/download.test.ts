import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * downloadViaApi / api(): a download after the access token has expired (e.g. "Download my
 * data" after the tab sat idle) must refresh the session first, not send a request that 401s.
 */

interface Call {
  url: string;
  method: string;
}

const now = () => Math.floor(Date.now() / 1000);
let calls: Call[];
let cookie: string;
/** What the server does on /api/auth/refresh: set a new has_session expiry, or fail. */
let onRefresh: () => Response;
/** Whether the download endpoint still sees a valid access token. */
let accessValid: boolean;

function fakeFetch(input: RequestInfo | URL, init: RequestInit = {}): Promise<Response> {
  const url = String(input);
  calls.push({ url, method: init.method ?? 'GET' });
  if (url === '/api/auth/refresh') {
    const res = onRefresh();
    if (res.ok) accessValid = true;
    return Promise.resolve(res);
  }
  if (!accessValid) return Promise.resolve(new Response(JSON.stringify({ statusCode: 401, message: 'Unauthorized' }), { status: 401 }));
  return Promise.resolve(new Response('{"me":1}', { status: 200, headers: { 'content-type': 'application/json' } }));
}

async function load() {
  vi.resetModules();
  return import('./download');
}

beforeEach(() => {
  calls = [];
  accessValid = true;
  onRefresh = () => {
    cookie = `NEXT_LOCALE=en; has_session=${now() + 900}`;
    return new Response('{"ok":true}', { status: 200 });
  };
  const anchor = { href: '', download: '', click: vi.fn() };
  vi.stubGlobal('fetch', vi.fn(fakeFetch));
  vi.stubGlobal('document', {
    get cookie() {
      return cookie;
    },
    createElement: () => anchor,
  });
  vi.stubGlobal('URL', Object.assign(URL, { createObjectURL: vi.fn(() => 'blob:x'), revokeObjectURL: vi.fn() }));
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('downloadViaApi', () => {
  it('refreshes first when the access token has expired, so no request 401s', async () => {
    cookie = `NEXT_LOCALE=en; has_session=${now() - 60}`;
    accessValid = false;
    const { downloadViaApi } = await load();
    await downloadViaApi('/me/export', 'data.json');
    expect(calls).toEqual([
      { url: '/api/auth/refresh', method: 'POST' },
      { url: '/api/me/export', method: 'GET' },
    ]);
  });

  it('refreshes shortly before expiry too', async () => {
    cookie = `has_session=${now() + 10}`;
    const { downloadViaApi } = await load();
    await downloadViaApi('/admin/students.csv', 'students.csv');
    expect(calls.map((c) => c.url)).toEqual(['/api/auth/refresh', '/api/admin/students.csv']);
  });

  it('does not refresh while the access token is still valid', async () => {
    cookie = `has_session=${now() + 600}`;
    const { downloadViaApi } = await load();
    await downloadViaApi('/me/export', 'data.json');
    expect(calls.map((c) => c.url)).toEqual(['/api/me/export']);
  });

  it('older sessions (has_session=1) still refresh on a 401 and retry once', async () => {
    cookie = 'has_session=1';
    accessValid = false;
    const { downloadViaApi } = await load();
    await downloadViaApi('/me/export', 'data.json');
    expect(calls.map((c) => c.url)).toEqual(['/api/me/export', '/api/auth/refresh', '/api/me/export']);
  });

  it('never refreshes twice in one call', async () => {
    cookie = `has_session=${now() - 60}`;
    accessValid = false;
    onRefresh = () => new Response('{"ok":false}', { status: 401 });
    const { downloadViaApi } = await load();
    await expect(downloadViaApi('/me/export', 'data.json')).rejects.toMatchObject({ status: 401 });
    expect(calls.map((c) => c.url)).toEqual(['/api/auth/refresh', '/api/me/export']);
  });

  it('stops trusting the expiry when this clock is off (still "expired" right after a refresh)', async () => {
    cookie = `has_session=${now() - 3600}`;
    accessValid = false;
    onRefresh = () => new Response('{"ok":true}', { status: 200 }); // the new expiry still looks past here
    const { downloadViaApi } = await load();
    await downloadViaApi('/me/export', 'data.json');
    await new Promise((r) => setTimeout(r, 0)); // let the deduplicated refresh settle
    await downloadViaApi('/me/export', 'data.json');
    expect(calls.map((c) => c.url)).toEqual(['/api/auth/refresh', '/api/me/export', '/api/me/export']);
  });
});
