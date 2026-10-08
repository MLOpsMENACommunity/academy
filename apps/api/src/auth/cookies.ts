import type { CookieOptions, Response } from 'express';
import type { Env } from '../config/env';

export const ACCESS_COOKIE = 'access_token';
export const REFRESH_COOKIE = 'refresh_token';
/** Non-secret flag readable by the Next middleware: "a refresh is possible". */
export const SESSION_COOKIE = 'has_session';
export const OAUTH_STATE_COOKIE = 'oauth_state';

/** Refresh tokens are only ever sent to the auth endpoints. */
const REFRESH_PATH = '/api/auth';

function base(env: Env): CookieOptions {
  return {
    httpOnly: true,
    secure: env.COOKIE_SECURE ?? env.NODE_ENV === 'production',
    sameSite: 'lax',
    domain: env.COOKIE_DOMAIN || undefined,
  };
}

export function setAuthCookies(res: Response, env: Env, access: string, refresh: string): void {
  const refreshMaxAge = env.REFRESH_TOKEN_TTL_DAYS * 24 * 60 * 60 * 1000;
  res.cookie(ACCESS_COOKIE, access, { ...base(env), path: '/', maxAge: env.ACCESS_TOKEN_TTL_MIN * 60 * 1000 });
  res.cookie(REFRESH_COOKIE, refresh, { ...base(env), path: REFRESH_PATH, maxAge: refreshMaxAge });
  // Readable by JS on purpose: it holds no secret and lets the UI skip /me calls for visitors.
  res.cookie(SESSION_COOKIE, '1', { ...base(env), httpOnly: false, path: '/', maxAge: refreshMaxAge });
}

export function clearAuthCookies(res: Response, env: Env): void {
  res.clearCookie(ACCESS_COOKIE, { ...base(env), path: '/' });
  res.clearCookie(REFRESH_COOKIE, { ...base(env), path: REFRESH_PATH });
  res.clearCookie(SESSION_COOKIE, { ...base(env), httpOnly: false, path: '/' });
}

export function setOAuthStateCookie(res: Response, env: Env, value: string): void {
  res.cookie(OAUTH_STATE_COOKIE, value, { ...base(env), path: '/api/auth/google', maxAge: 10 * 60 * 1000 });
}

export function clearOAuthStateCookie(res: Response, env: Env): void {
  res.clearCookie(OAUTH_STATE_COOKIE, { ...base(env), path: '/api/auth/google' });
}
