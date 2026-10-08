'use client';

import Link from 'next/link';
import { useI18n } from '@/i18n/client';
import { buttonClass } from '../ui/Button';

/** Auth-aware part of the header. Phase 2 swaps this for the signed-in menu. */
export function UserNav() {
  const { locale, t } = useI18n();
  return (
    <>
      <Link
        href={`/${locale}/login`}
        className="hidden min-h-9 items-center rounded-lg px-3 text-sm font-semibold text-fg hover:bg-muted-bg sm:inline-flex"
      >
        {t('nav.login')}
      </Link>
      <Link href={`/${locale}/register`} className={buttonClass('primary', 'sm')}>
        {t('nav.register')}
      </Link>
    </>
  );
}
