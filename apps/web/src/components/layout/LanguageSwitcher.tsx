'use client';

import { usePathname } from 'next/navigation';
import type { MouseEvent } from 'react';
import { LOCALE_COOKIE } from '@/i18n/config';
import { useI18n } from '@/i18n/client';

/** Swaps the locale segment and keeps the rest of the URL, including the query string. */
export function LanguageSwitcher({ className = '' }: { className?: string }) {
  const { locale, t } = useI18n();
  const pathname = usePathname() ?? `/${locale}`;
  const target = locale === 'en' ? 'ar' : 'en';
  const href = pathname.replace(/^\/(en|ar)(?=\/|$)/, `/${target}`);

  function onClick(e: MouseEvent<HTMLAnchorElement>) {
    document.cookie = `${LOCALE_COOKIE}=${target}; path=/; max-age=31536000; samesite=lax`;
    if (window.location.search || window.location.hash) {
      e.preventDefault();
      window.location.assign(href + window.location.search + window.location.hash);
    }
  }

  return (
    <a
      href={href}
      hrefLang={target}
      lang={target}
      onClick={onClick}
      className={`inline-flex min-h-9 items-center rounded-lg px-3 text-sm font-semibold text-fg hover:bg-muted-bg ${className}`}
      aria-label={`${t('common.language')}: ${t('common.switchTo')}`}
    >
      {t('common.switchTo')}
    </a>
  );
}
