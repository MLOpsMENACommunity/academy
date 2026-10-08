import { LOCALES, type Locale } from '@academy/shared';

export const locales = LOCALES;
export const defaultLocale: Locale = 'en';
export const LOCALE_COOKIE = 'NEXT_LOCALE';

export function isLocale(value: string | undefined): value is Locale {
  return value === 'en' || value === 'ar';
}

export function dirOf(locale: Locale): 'ltr' | 'rtl' {
  return locale === 'ar' ? 'rtl' : 'ltr';
}

/** Intl locale tags. Arabic uses Latin digits (ar-EG with nu-latn) to keep times and prices readable. */
export function intlLocale(locale: Locale): string {
  return locale === 'ar' ? 'ar-EG-u-nu-latn' : 'en-GB';
}
