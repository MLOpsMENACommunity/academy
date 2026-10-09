'use client';

import { safeReturnTo } from '@academy/shared';
import { useI18n } from '@/i18n/client';
import { useSearchParam } from './use-search-param';

/**
 * The sanitised `returnTo` query param, defaulting to the dashboard. Read on the client
 * only, so the login and register pages stay static (see useSearchParam).
 */
export function useReturnTo(): string {
  const { locale } = useI18n();
  return safeReturnTo(useSearchParam('returnTo'), `/${locale}/dashboard`);
}

export function withReturnTo(path: string, returnTo: string | null | undefined): string {
  return returnTo ? `${path}?returnTo=${encodeURIComponent(returnTo)}` : path;
}
