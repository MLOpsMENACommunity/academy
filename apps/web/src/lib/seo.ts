import type { Locale } from '@academy/shared';
import type { Metadata } from 'next';
import { absoluteUrl } from './site';

/** Canonical + hreflang alternates for a path that exists in both locales (path without locale). */
export function alternates(locale: Locale, path: string): Metadata['alternates'] {
  return {
    canonical: absoluteUrl(`/${locale}${path}`),
    languages: {
      en: absoluteUrl(`/en${path}`),
      ar: absoluteUrl(`/ar${path}`),
      'x-default': absoluteUrl(`/en${path}`),
    },
  };
}
