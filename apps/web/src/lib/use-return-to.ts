'use client';

import { safeReturnTo } from '@academy/shared';
import { useSearchParams } from 'next/navigation';
import { useI18n } from '@/i18n/client';

/** The sanitised `returnTo` query param, defaulting to the dashboard. */
export function useReturnTo(): string {
  const { locale } = useI18n();
  const params = useSearchParams();
  return safeReturnTo(params.get('returnTo'), `/${locale}/dashboard`);
}

export function withReturnTo(path: string, returnTo: string | null | undefined): string {
  return returnTo ? `${path}?returnTo=${encodeURIComponent(returnTo)}` : path;
}
