import { DEFAULT_TIMEZONE, type Locale } from '@academy/shared';
import { intlLocale } from '@/i18n/config';

export function formatDate(iso: string | Date, locale: Locale, timeZone = DEFAULT_TIMEZONE): string {
  return new Intl.DateTimeFormat(intlLocale(locale), { dateStyle: 'medium', timeZone }).format(new Date(iso));
}

export function formatDateTime(iso: string | Date, locale: Locale, timeZone = DEFAULT_TIMEZONE): string {
  // dateStyle/timeStyle can't be combined with timeZoneName, so list the parts.
  return new Intl.DateTimeFormat(intlLocale(locale), {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
    timeZone,
    timeZoneName: 'short',
  }).format(new Date(iso));
}

/** The currency as people write it in this language ("EGP", "ج.م.‏"), for labels such as "Amount paid (EGP)". */
export function currencyLabel(currency: string, locale: Locale): string {
  try {
    return new Intl.NumberFormat(intlLocale(locale), { style: 'currency', currency }).formatToParts(0).find((p) => p.type === 'currency')?.value ?? currency;
  } catch {
    return currency;
  }
}

export function formatMoney(amount: number, currency: string, locale: Locale): string {
  return new Intl.NumberFormat(intlLocale(locale), { style: 'currency', currency, maximumFractionDigits: 0 }).format(
    amount,
  );
}

/** The viewer's timezone, falling back to Cairo (most students) during SSR. */
export function viewerTimezone(): string {
  if (typeof Intl === 'undefined' || typeof window === 'undefined') return DEFAULT_TIMEZONE;
  return Intl.DateTimeFormat().resolvedOptions().timeZone || DEFAULT_TIMEZONE;
}
