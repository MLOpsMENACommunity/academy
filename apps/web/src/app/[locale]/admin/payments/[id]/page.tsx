'use client';

import { countryName, paymentMethodLabels, paymentStatusLabels, type AdminPaymentDto } from '@academy/shared';
import Link from 'next/link';
import { useParams } from 'next/navigation';
import { useCallback, useEffect, useState } from 'react';
import { CheckboxField, TextAreaField } from '@/components/forms/fields';
import { Alert } from '@/components/ui/Alert';
import { Badge } from '@/components/ui/Badge';
import { Button } from '@/components/ui/Button';
import { Card } from '@/components/ui/Card';
import { PageSpinner } from '@/components/ui/Spinner';
import { useI18n } from '@/i18n/client';
import { api } from '@/lib/api';
import { errorMessage } from '@/lib/errors';
import { formatDate, formatDateTime, formatMoney } from '@/lib/format';

export default function PaymentReview() {
  const { locale, t } = useI18n();
  const { id } = useParams<{ id: string }>();
  const [p, setP] = useState<AdminPaymentDto | null>(null);
  const [shot, setShot] = useState<{ url: string; mime: string | null } | null>(null);
  const [verified, setVerified] = useState(false);
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState<'approve' | 'reject' | 'shot' | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(() => {
    api<AdminPaymentDto>(`/admin/payments/${id}`).then(setP).catch((e: unknown) => setError(errorMessage(e, t)));
  }, [id, t]);
  useEffect(load, [load]);

  async function act(kind: 'approve' | 'reject') {
    setBusy(kind);
    setError(null);
    try {
      const body = kind === 'approve' ? { verifiedInHistory: verified } : { reason };
      setP(await api<AdminPaymentDto>(`/admin/payments/${id}/${kind}`, { method: 'POST', json: body }));
    } catch (e) {
      setError(errorMessage(e, t));
    } finally {
      setBusy(null);
    }
  }

  async function viewScreenshot() {
    setBusy('shot');
    try {
      setShot(await api<{ url: string; mime: string | null }>(`/admin/payments/${id}/screenshot`));
    } catch (e) {
      setError(errorMessage(e, t));
    } finally {
      setBusy(null);
    }
  }

  if (!p) return error ? <Alert tone="danger">{error}</Alert> : <PageSpinner />;
  const pending = p.status === 'PENDING_REVIEW';
  const row = (label: string, value: React.ReactNode) => (
    <div className="grid grid-cols-[9rem_1fr] gap-2 py-1.5 text-sm">
      <dt className="text-muted">{label}</dt>
      <dd className="font-medium text-fg">{value}</dd>
    </div>
  );

  return (
    <div className="space-y-5">
      <Link href={`/${locale}/admin/payments`} className="text-sm text-primary hover:underline">
        <span aria-hidden className="inline-block rtl:rotate-180">←</span> {t('admin.payments.back')}
      </Link>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-2xl">{p.student.name ?? p.student.email}</h1>
        <Badge tone={p.status === 'APPROVED' ? 'success' : p.status === 'REJECTED' ? 'danger' : 'info'}>{paymentStatusLabels[p.status][locale]}</Badge>
      </div>

      {/* Persistent, not dismissible (Risk 2). */}
      <Alert tone="warning" title={t('admin.payments.verifyWarning')} />

      {(p.flags.duplicateRef || p.flags.duplicateScreenshot || p.flags.amountMismatch) && (
        <Alert tone="danger">
          <ul className="list-disc ps-5">
            {p.flags.duplicateRef && <li>{t('admin.payments.flags.duplicateRef')}</li>}
            {p.flags.duplicateScreenshot && <li>{t('admin.payments.flags.duplicateScreenshot')}</li>}
            {p.flags.amountMismatch && (
              <li>
                {t('admin.payments.flags.amountMismatch')}: {formatMoney(p.amount, p.currency, locale)} ≠{' '}
                {formatMoney(p.course.price, p.course.currency, locale)}
              </li>
            )}
          </ul>
        </Alert>
      )}

      <div className="grid gap-5 lg:grid-cols-2">
        <Card>
          <h2 className="text-lg">{t('payment.formTitle')}</h2>
          <dl className="mt-3 divide-y divide-line">
            {row(t('payment.method'), paymentMethodLabels[p.method][locale])}
            {row(t('payment.amount'), formatMoney(p.amount, p.currency, locale))}
            {row(t('admin.payments.expected'), formatMoney(p.course.price, p.course.currency, locale))}
            {row(t('payment.transactionRef'), <span className="ltr-embed font-mono">{p.transactionRef}</span>)}
            {row(t('payment.senderName'), p.senderName)}
            {row(t('payment.senderPhone'), <span className="ltr-embed">{p.senderPhone}</span>)}
            {row(t('payment.paidAt'), formatDate(p.paidAt, locale))}
            {row(t('admin.payments.submittedAt'), formatDateTime(p.createdAt, locale))}
            {row(t('admin.payments.course'), p.course.titleEn)}
          </dl>
        </Card>
        <Card>
          <h2 className="text-lg">{t('admin.payments.student')}</h2>
          <dl className="mt-3 divide-y divide-line">
            {row(t('auth.email'), <span className="ltr-embed">{p.student.email}</span>)}
            {row(t('profile.fields.phone'), <span className="ltr-embed">{p.student.phone ?? '—'}</span>)}
            {row(t('profile.fields.country'), p.student.country ? countryName(p.student.country, locale) : '—')}
            {row(t('profile.fields.jobTitle'), p.student.jobTitle ?? '—')}
            {row(t('profile.fields.googleEmail'), <span className="ltr-embed">{p.student.googleEmail ?? '—'}</span>)}
          </dl>
        </Card>
      </div>

      <Card>
        <h2 className="text-lg">{t('payment.screenshot')}</h2>
        {p.screenshotDeleted || !p.hasScreenshot ? (
          <p className="mt-2 text-sm text-muted">{t('admin.payments.screenshotDeleted')}</p>
        ) : shot ? (
          <div className="mt-3">
            <p className="mb-2 text-xs text-muted">{t('admin.payments.linkExpires')}</p>
            {shot.mime === 'application/pdf' ? (
              <a href={shot.url} target="_blank" rel="noreferrer" className="text-primary underline">
                PDF
              </a>
            ) : (
              // eslint-disable-next-line @next/next/no-img-element -- short-lived signed URL, must not go through the image optimiser
              <img src={shot.url} alt={t('payment.screenshot')} className="max-h-[70vh] w-auto rounded-lg border border-line" />
            )}
          </div>
        ) : (
          <Button type="button" variant="secondary" className="mt-3" loading={busy === 'shot'} onClick={viewScreenshot}>
            {t('admin.payments.viewScreenshot')}
          </Button>
        )}
      </Card>

      {p.duplicates.length > 0 && (
        <Card>
          <h2 className="text-lg">{t('admin.payments.duplicates')}</h2>
          <ul className="mt-2 space-y-1 text-sm">
            {p.duplicates.map((d) => (
              <li key={d.id}>
                <Link href={`/${locale}/admin/payments/${d.id}`} className="text-primary underline">
                  {d.studentName ?? '—'} · {d.courseTitle}
                </Link>{' '}
                · {paymentStatusLabels[d.status][locale]} · {formatDate(d.createdAt, locale)}
              </li>
            ))}
          </ul>
        </Card>
      )}

      {error && <Alert tone="danger">{error}</Alert>}

      {pending ? (
        <div className="grid gap-5 lg:grid-cols-2">
          <Card className="border-success/40">
            <CheckboxField label={t('admin.payments.verifiedCheckbox')} checked={verified} onChange={setVerified} />
            <Button type="button" className="mt-4" variant="accent" disabled={!verified} loading={busy === 'approve'} onClick={() => act('approve')}>
              {t('admin.payments.approve')}
            </Button>
          </Card>
          <Card className="border-danger/30">
            <TextAreaField label={t('admin.payments.rejectReason')} required value={reason} onChange={setReason} rows={3} maxLength={1000} />
            <Button type="button" className="mt-4" variant="danger" disabled={reason.trim().length < 3} loading={busy === 'reject'} onClick={() => act('reject')}>
              {t('admin.payments.reject')}
            </Button>
          </Card>
        </div>
      ) : (
        p.reviewedAt && (
          <p className="text-sm text-muted">
            {t('admin.payments.reviewedBy', { who: p.reviewedBy ?? '—', date: formatDateTime(p.reviewedAt, locale) })}
            {p.rejectionReason && ` · ${t('payment.rejectedReason', { reason: p.rejectionReason })}`}
          </p>
        )
      )}
    </div>
  );
}
