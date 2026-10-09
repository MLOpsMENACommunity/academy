import type { Locale } from '@academy/shared';
import type { Metadata } from 'next';
import { isLocale } from '@/i18n/config';
import { createTranslator } from '@/i18n/translator';
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

/**
 * A page's own <title> from a translation key; the locale layout's template adds
 * " | MLOps MENA Academy" (e.g. "Log in | MLOps MENA Academy").
 */
export function pageTitle(locale: string, key: string): Metadata {
  return isLocale(locale) ? { title: createTranslator(locale)(key) } : {};
}

/**
 * The site-wide social card (app/og-default.png/route.tsx), for pages without their own image.
 * Pages that set `openGraph` replace the layout's whole openGraph object, images included,
 * so they add this themselves when they have no image of their own.
 */
export const DEFAULT_OG_IMAGE = { url: '/og-default.png', width: 1200, height: 630, alt: 'MLOps MENA Academy' } as const;
