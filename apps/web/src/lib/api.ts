'use client';

/**
 * Browser-side API client. Talks to same-origin /api (cookies are httpOnly).
 * On 401 it refreshes the session once (deduplicated across concurrent calls)
 * and retries.
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

export function hasSessionCookie(): boolean {
  return typeof document !== 'undefined' && /(?:^|;\s*)has_session=/.test(document.cookie);
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
    res = await fetch(`/api${path}`, opts);
    if (res.status === 401 && !path.startsWith('/auth/') && (await refreshSession())) {
      res = await fetch(`/api${path}`, opts);
    }
  } catch {
    throw new ApiError(0, 'NETWORK', 'Network error');
  }
  if (!res.ok) throw await toError(res);
  if (res.status === 204) return undefined as T;
  const type = res.headers.get('content-type') ?? '';
  return (type.includes('application/json') ? res.json() : res.text()) as Promise<T>;
}
