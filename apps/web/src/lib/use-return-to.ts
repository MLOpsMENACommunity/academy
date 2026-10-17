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
  const returnTo = safeReturnTo(useSearchParam('returnTo'), `/${locale}/dashboard`);
  const hash = useSyncExternalStore(subscribeHash, () => window.location.hash, () => '');
  return !returnTo.includes('#') && isCarriedHash(hash) && /^\/(en|ar)\/learn\//.test(returnTo) ? `${returnTo}${hash}` : returnTo;
}

function subscribeHash(onChange: () => void): () => void {
  window.addEventListener('hashchange', onChange);
  return () => window.removeEventListener('hashchange', onChange);
}

export function withReturnTo(path: string, returnTo: string | null | undefined): string {
  return returnTo ? `${path}?returnTo=${encodeURIComponent(returnTo)}` : path;
}
