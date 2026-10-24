'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useI18n } from '@/i18n/client';

/** "Consultations" in the top menu: paid 1:1 calls with the academy's experts. */
export function ConsultationsLink({ className = '', onNavigate }: { className?: string; onNavigate?: () => void }) {
  const { locale, t } = useI18n();
  const pathname = usePathname() ?? '';
  const href = `/${locale}/consultations`;
  return (
    <Link href={href} className={className} aria-current={pathname.startsWith(href) ? 'page' : undefined} onClick={onNavigate}>
      {t('nav.consultations')}
    </Link>
  );
}
