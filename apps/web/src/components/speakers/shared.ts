import { cairoMonthKey } from '@academy/shared';
import type { Tone } from '@/components/ui/Badge';
import { intlLocale } from '@/i18n/config';
import type { Translate } from '@/i18n/translator';
import { ApiError } from '@/lib/api';
import { errorMessage } from '@/lib/errors';

/**
 * API error codes of the speaker portal have their own messages; the rest use the usual ones.
 * A server error is never just "Something went wrong": its code (and the API's own message,
 * when there is no translation) is shown, so a speaker can tell the team what happened.
 */
export function speakerError(err: unknown, t: Translate): string {
  if (err instanceof ApiError && err.code) {
    const key = `speakers.portal.errors.${err.code}`;
    const msg = t(key);
    if (msg !== key) return err.status >= 500 ? `${msg} (${err.code})` : msg;
    if (err.status >= 500 && err.message) return `${err.message} (${err.code})`;
  }
  // The edge answers a plain 503 while the API container wakes up (or a request timed out).
  if (err instanceof ApiError && err.status === 503) return t('speakers.portal.errors.unavailable');
  if (err instanceof ApiError && err.status >= 500) return `${t('errors.generic')} (${t('speakers.portal.errors.status', { status: err.status })})`;
  return errorMessage(err, t);
}

/** "2026-11" → "November 2026" in the reader's language. */
export function monthLabel(key: string, locale: 'en' | 'ar'): string {
  const [y, m] = key.split('-').map(Number) as [number, number];
  return new Intl.DateTimeFormat(intlLocale(locale), { month: 'long', year: 'numeric', timeZone: 'UTC' }).format(new Date(Date.UTC(y, m - 1, 15)));
}

/** This month and the next `count - 1`, as "YYYY-MM" (Cairo calendar). */
export function upcomingMonths(count: number, from = new Date()): string[] {
  const [y, m] = cairoMonthKey(from).split('-').map(Number) as [number, number];
  return Array.from({ length: count }, (_, i) => {
    const d = new Date(Date.UTC(y, m - 1 + i, 1));
    return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`;
  });
}

/** Groups items by Cairo month, keeping their order. */
export function byMonth<T extends { startsAt: string }>(items: T[]): [string, T[]][] {
  const out = new Map<string, T[]>();
  for (const item of items) {
    const key = cairoMonthKey(item.startsAt);
    out.set(key, [...(out.get(key) ?? []), item]);
  }
  return [...out];
}

/** Badge colour per application status. */
export const SPEAKER_APP_TONE: Record<string, Tone> = { SUBMITTED: 'warning', APPROVED: 'success', REJECTED: 'danger' };
