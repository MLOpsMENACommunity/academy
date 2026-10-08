'use client';

import type { AdminPaymentDto, PaymentStatus } from '@academy/shared';
import Link from 'next/link';
import { useEffect, useState } from 'react';
import { Alert } from '@/components/ui/Alert';
import { Badge } from '@/components/ui/Badge';
import { useI18n } from '@/i18n/client';
import { api } from '@/lib/api';
import { formatDateTime, formatMoney } from '@/lib/format';

const TABS: { status: PaymentStatus; key: string }[] = [
  { status: 'PENDING_REVIEW', key: 'pending' },
  { status: 'APPROVED', key: 'approved' },
  { status: 'REJECTED', key: 'rejected' },
];

export default function PaymentsQueue() {
  const { locale, t } = useI18n();
  const [status, setStatus] = useState<PaymentStatus>('PENDING_REVIEW');
  const [items, setItems] = useState<AdminPaymentDto[] | null>(null);
  const [error, setError] = useState(false);

  useEffect(() => {
    setItems(null);
    api<AdminPaymentDto[]>(`/admin/payments?status=${status}`)
      .then(setItems)
      .catch(() => setError(true));
  }, [status]);

  return (
    <div>
      <h1 className="text-3xl">{t('admin.payments.title')}</h1>
      <Alert tone="warning" className="mt-4">
        {t('admin.payments.verifyWarning')}
      </Alert>
      <div role="tablist" className="mt-6 flex gap-1 border-b border-line">
        {TABS.map((tab) => (
          <button
            key={tab.status}
            role="tab"
            aria-selected={status === tab.status}
            onClick={() => setStatus(tab.status)}
            className={`min-h-11 border-b-2 px-3 text-sm font-semibold ${status === tab.status ? 'border-primary text-primary' : 'border-transparent text-muted'}`}
          >
            {t(`admin.payments.${tab.key}`)}
          </button>
        ))}
      </div>
      {status === 'PENDING_REVIEW' && <p className="mt-3 text-xs text-muted">{t('admin.payments.oldestFirst')}</p>}
      {error && <Alert tone="danger" className="mt-4">{t('errors.generic')}</Alert>}
      {items?.length === 0 && <p className="mt-6 text-muted">{t('admin.payments.empty')}</p>}
      <ul className="mt-4 space-y-3">
        {items?.map((p) => (
          <li key={p.id}>
            <Link
              href={`/${locale}/admin/payments/${p.id}`}
              className="flex flex-wrap items-center justify-between gap-3 rounded-card border border-line bg-card p-4 hover:border-primary"
            >
              <div className="min-w-0">
                <p className="font-semibold text-fg">{p.student.name ?? p.student.email}</p>
                <p className="text-sm text-muted">
                  {p.course.titleEn} · {formatMoney(p.amount, p.currency, locale)} · <span className="ltr-embed">{p.transactionRef}</span>
                </p>
                <p className="text-xs text-muted">{formatDateTime(p.createdAt, locale)}</p>
              </div>
              <div className="flex flex-wrap gap-1.5">
                {p.flags.duplicateRef && <Badge tone="danger">{t('admin.payments.flags.duplicateRef')}</Badge>}
                {p.flags.duplicateScreenshot && <Badge tone="danger">{t('admin.payments.flags.duplicateScreenshot')}</Badge>}
                {p.flags.amountMismatch && <Badge tone="warning">{t('admin.payments.flags.amountMismatch')}</Badge>}
              </div>
            </Link>
          </li>
        ))}
      </ul>
    </div>
  );
}
