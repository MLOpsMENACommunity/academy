'use client';

/**
 * Browser-side API client. Talks to same-origin /api (cookies are httpOnly).
 * When the access token has expired (the has_session cookie says when) it refreshes
 * first; otherwise, on a 401, it refreshes and retries. Either way at most one refresh
 * per call, deduplicated across concurrent calls.
 */

export interface FieldError {
  path: string;
  message: string;
}

export class ApiError extends Error {
  constructor(
    public readonly status: number,
    public readonly code: string | undefined,
    message: string,
    public readonly errors: FieldError[] = [],
  ) {
    super(message);
  }

  /** Field errors keyed by path, for forms. */
  fieldErrors(): Record<string, string> {
    return Object.fromEntries(this.errors.map((e) => [e.path, e.message]));
  }
}

let refreshing: Promise<boolean> | null = null;
/** Endpoints where a 401 means "bad credentials", not "expired session". */
const NO_REFRESH = new Set(['/auth/login', '/auth/register', '/auth/refresh', '/auth/logout']);

export function hasSessionCookie(): boolean {
  return typeof document !== 'undefined' && /(?:^|;\s*)has_session=/.test(document.cookie);
}

/** Refresh this many seconds before the access token expires (slow networks, small clock drift). */
const EXPIRY_MARGIN_S = 30;
/** Set when this browser's clock disagrees with the server's: rely on 401s instead. */
let expiryUnreliable = false;

/**
 * When the access token expires (Unix seconds), from the has_session cookie the API sets
 * alongside it; null when unknown (signed out, or a session from before the cookie held it).
 */
export function accessTokenExpiry(cookie: string = typeof document === 'undefined' ? '' : document.cookie): number | null {
  const m = /(?:^|;\s*)has_session=(\d{9,12})(?:;|$)/.exec(cookie);
  return m ? Number(m[1]) : null;
}

function accessTokenExpired(): boolean {
  const exp = accessTokenExpiry();
  return exp !== null && Date.now() / 1000 >= exp - EXPIRY_MARGIN_S;
}

async function refreshSession(): Promise<boolean> {
  refreshing ??= fetch('/api/auth/refresh', { method: 'POST', credentials: 'same-origin' })
    // 409: another tab rotated the token a moment ago; its new cookies are already in the jar.
    .then((r) => r.ok || r.status === 409)
    .catch(() => false)
    .finally(() => {
      setTimeout(() => (refreshing = null), 0);
    });
  return refreshing;
}

async function toError(res: Response): Promise<ApiError> {
  let body: { message?: string | string[]; code?: string; errors?: FieldError[] } = {};
  try {
    body = await res.json();
  } catch {
    // non-JSON error
  }
  const message = Array.isArray(body.message) ? body.message.join(', ') : (body.message ?? res.statusText);
  return new ApiError(res.status, body.code, message, body.errors ?? []);
}

export async function api<T>(path: string, init: RequestInit & { json?: unknown } = {}): Promise<T> {
  const { json, ...rest } = init;
  const opts: RequestInit = {
    credentials: 'same-origin',
    ...rest,
    headers: {
      Accept: 'application/json',
      ...(json !== undefined ? { 'Content-Type': 'application/json' } : {}),
      ...rest.headers,
    },
    body: json !== undefined ? JSON.stringify(json) : rest.body,
  };
  let res: Response;
  try {
    const mayRefresh = !NO_REFRESH.has(path);
    // Refresh first when the access token is known to have expired: no doomed request, no 401
    // (downloads, exports and anything else after the tab sat idle past the token's lifetime).
    let refreshed = false;
    if (mayRefresh && !expiryUnreliable && accessTokenExpired()) {
      refreshed = true;
      // Still "expired" right after a successful refresh: this clock is off; stop trusting it.
      if ((await refreshSession()) && accessTokenExpired()) expiryUnreliable = true;
    }
    res = await fetch(`/api${path}`, opts);
    // Never a second refresh in one call: a refresh whose new cookies were lost would look like
    // token theft to the API (see AuthProvider).
    if (res.status === 401 && mayRefresh && !refreshed && (await refreshSession())) {
      res = await fetch(`/api${path}`, opts);
    }
  } catch {
    throw new ApiError(0, 'NETWORK', 'Network error');
  }
  if (!res.ok) throw await toError(res);
  if (res.status === 204) return undefined as T;
  if (init.headers && (init.headers as Record<string, string>).Accept === 'application/octet-stream') {
    return (await res.blob()) as T;
  }
  const type = res.headers.get('content-type') ?? '';
  return (type.includes('application/json') ? res.json() : res.text()) as Promise<T>;
}
