'use client';

import { isCarriedHash, safeReturnTo } from '@academy/shared';
import { useSyncExternalStore } from 'react';
import { useI18n } from '@/i18n/client';
import { useSearchParam } from './use-search-param';

/**
 * The sanitised `returnTo` query param, defaulting to the dashboard. Read on the client
 * only, so the login and register pages stay static (see useSearchParam).
 *
 * A link like /learn/x#session-3-feedback opened while signed out is redirected to login by
 * the middleware, which never sees the #fragment; the browser keeps it on the login URL
 * instead. A learn-page fragment found there is put back on returnTo, so signing in lands on
 * the rating form. Other fragments (e.g. #email= on sign-in links) are left alone.
 */
export function useReturnTo(): string {
  const { locale } = useI18n();
  const fallback = `/${locale}/dashboard`;
  const raw = safeReturnTo(useSearchParam('returnTo'), fallback);
  // Back to the login page after logging in would show the form to a signed-in user.
  const returnTo = isAuthPage(raw) ? fallback : raw;
  const hash = useSyncExternalStore(subscribeHash, () => window.location.hash, () => '');
  return !returnTo.includes('#') && isCarriedHash(hash) && /^\/(en|ar)\/learn\//.test(returnTo) ? `${returnTo}${hash}` : returnTo;
}

/** The sign-in pages themselves: never a place to return to after signing in. */
export function isAuthPage(path: string): boolean {
  return /^\/(?:(?:en|ar)\/)?(?:login|register|forgot-password|reset-password)(?:[/?#]|$)/.test(path);
}

function subscribeHash(onChange: () => void): () => void {
  window.addEventListener('hashchange', onChange);
  return () => window.removeEventListener('hashchange', onChange);
}

export function withReturnTo(path: string, returnTo: string | null | undefined): string {
  return returnTo ? `${path}?returnTo=${encodeURIComponent(returnTo)}` : path;
}
