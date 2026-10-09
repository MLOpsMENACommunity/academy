'use client';

import { buttonClass } from '@/components/ui/Button';
import { Container } from '@/components/ui/Container';
import { useI18n } from '@/i18n/client';
import Link from 'next/link';

/** The localized 404 body (client: it reads the locale from the i18n context). */
export function NotFoundView() {
  const { locale, t } = useI18n();
  return (
    <Container className="py-24 text-center">
      <h1 className="text-3xl">{t('errors.notFoundTitle')}</h1>
      <p className="mt-3 text-muted">{t('errors.notFoundBody')}</p>
      <Link href={`/${locale}`} className={buttonClass('primary', 'md', 'mt-6')}>
        {t('errors.goHome')}
      </Link>
    </Container>
  );
}
