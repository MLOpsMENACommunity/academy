'use client';

import Link from 'next/link';
import { useEffect, useState } from 'react';
import { buttonClass } from '@/components/ui/Button';
import { Card } from '@/components/ui/Card';
import { useI18n } from '@/i18n/client';
import { api } from '@/lib/api';

/** Admin home. The full dashboard (counts per course, funnel) comes with the admin panel phase. */
export default function AdminHome() {
  const { locale, t } = useI18n();
  const [pending, setPending] = useState<number | null>(null);
  useEffect(() => {
    api<unknown[]>('/admin/payments?status=PENDING_REVIEW')
      .then((r) => setPending(r.length))
      .catch(() => setPending(null));
  }, []);
  return (
    <div>
      <h1 className="text-3xl">{t('admin.nav.dashboard')}</h1>
      <div className="mt-6 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        <Card>
          <p className="text-sm text-muted">{t('admin.payments.title')}</p>
          <p className="mt-1 text-4xl font-bold text-fg">{pending ?? '–'}</p>
          <p className="text-sm text-muted">{t('admin.payments.pending')}</p>
          <Link href={`/${locale}/admin/payments`} className={buttonClass('primary', 'sm', 'mt-4')}>
            {t('admin.nav.payments')}
          </Link>
        </Card>
      </div>
    </div>
  );
}
