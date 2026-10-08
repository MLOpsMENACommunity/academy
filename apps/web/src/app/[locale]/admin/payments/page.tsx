'use client';

import type { AdminPaymentDto, PaymentStatus } from '@academy/shared';
import Link from 'next/link';
import { useEffect, useRef, useState, type KeyboardEvent } from 'react';
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
  const tabs = useRef<Record<string, HTMLButtonElement | null>>({});

  useEffect(() => {
    let current = true; // ignore responses for a tab the admin already left
    setItems(null);
    setError(false);
    api<AdminPaymentDto[]>(`/admin/payments?status=${status}`)
      .then((r) => current && setItems(r))
      .catch(() => current && setError(true));
    return () => {
      current = false;
    };
  }, [status]);

  const onKey = (e: KeyboardEvent) => {
    const i = TABS.findIndex((x) => x.status === status);
    const fwd = locale === 'ar' ? 'ArrowLeft' : 'ArrowRight';
    const back = locale === 'ar' ? 'ArrowRight' : 'ArrowLeft';
    if (e.key !== fwd && e.key !== back) return;
    e.preventDefault();
    const next = TABS[(i + (e.key === fwd ? 1 : TABS.length - 1)) % TABS.length]!;
    setStatus(next.status);
    tabs.current[next.status]?.focus();
  };

  return (
    <div>
      <h1 className="text-3xl">{t('admin.payments.title')}</h1>
      <Alert tone="warning" className="mt-4">
        {t('admin.payments.verifyWarning')}
      </Alert>
      <div
        role="tablist"
        aria-label={t('admin.payments.title')}
        className="mt-6 flex gap-1 border-b border-line"
        onKeyDown={onKey}
      >
        {TABS.map((tab) => (
          <button
            key={tab.status}
            ref={(el) => {
              tabs.current[tab.status] = el;
            }}
            role="tab"
            id={`tab-${tab.status}`}
            aria-selected={status === tab.status}
            aria-controls="payments-panel"
            tabIndex={status === tab.status ? 0 : -1}
            onClick={() => setStatus(tab.status)}
            className={`min-h-11 border-b-2 px-3 text-sm font-semibold ${status === tab.status ? 'border-primary text-primary' : 'border-transparent text-muted'}`}
          >
            {t(`admin.payments.${tab.key}`)}
          </button>
        ))}
      </div>
      {status === 'PENDING_REVIEW' && (
        <p className="mt-3 text-xs text-muted">{t('admin.payments.oldestFirst')}</p>
      )}
      <div
        id="payments-panel"
        role="tabpanel"
        aria-labelledby={`tab-${status}`}
        aria-busy={items === null && !error}
      >
        {error && (
          <Alert tone="danger" className="mt-4">
            {t('errors.generic')}
          </Alert>
        )}
        {items === null && !error && <p className="mt-6 text-muted">{t('common.loading')}</p>}
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
                    {locale === 'ar' ? p.course.titleAr : p.course.titleEn} ·{' '}
                    {formatMoney(p.amount, p.currency, locale)} ·{' '}
                    <span className="ltr-embed">{p.transactionRef}</span>
                  </p>
                  <p className="text-xs text-muted">{formatDateTime(p.createdAt, locale)}</p>
                </div>
                <div className="flex flex-wrap gap-1.5">
                  {p.flags.duplicateRef && (
                    <Badge tone="danger">{t('admin.payments.flags.duplicateRef')}</Badge>
                  )}
                  {p.flags.duplicateScreenshot && (
                    <Badge tone="danger">{t('admin.payments.flags.duplicateScreenshot')}</Badge>
                  )}
                  {p.flags.amountMismatch && (
                    <Badge tone="warning">{t('admin.payments.flags.amountMismatch')}</Badge>
                  )}
                </div>
              </Link>
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}
