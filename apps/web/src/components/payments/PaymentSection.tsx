'use client';

import {
  paymentMethodLabels,
  paymentProofSchema,
  paymentStatusLabels,
  type MyApplicationDetailDto,
  type MyPaymentDto,
  type PaymentInstructionsDto,
  type ProfileDto,
} from '@academy/shared';
import Link from 'next/link';
import { useCallback, useEffect, useRef, useState, type FormEvent } from 'react';
import { RadioGroup, TextField } from '@/components/forms/fields';
import { Alert } from '@/components/ui/Alert';
import { Badge } from '@/components/ui/Badge';
import { Button } from '@/components/ui/Button';
import { useI18n } from '@/i18n/client';
import { api, ApiError } from '@/lib/api';
import { errorMessage } from '@/lib/errors';
import { formatDate, formatMoney } from '@/lib/format';
import { issuesToErrors } from '@/lib/zod-errors';

const MAX = 5 * 1024 * 1024;

/** Today's date in the viewer's own timezone (not UTC), as YYYY-MM-DD. */
function localToday(): string {
  const d = new Date();
  return new Date(d.getTime() - d.getTimezoneOffset() * 60_000).toISOString().slice(0, 10);
}
const ACCEPT = ['image/jpeg', 'image/png', 'application/pdf'];

function CopyValue({ value }: { value: string }) {
  const { t } = useI18n();
  const [copied, setCopied] = useState(false);
  return (
    <span className="inline-flex items-center gap-2">
      <code className="ltr-embed rounded bg-muted-bg px-2 py-1 text-sm font-semibold text-fg">{value}</code>
      <button
        type="button"
        className="min-h-9 rounded px-2 text-xs font-semibold text-primary hover:underline"
        onClick={() =>
          navigator.clipboard
            ?.writeText(value)
            .then(() => {
              setCopied(true);
              setTimeout(() => setCopied(false), 1500);
            })
            .catch(() => undefined)
        }
      >
        {copied ? t('payment.copied') : t('payment.copy')}
      </button>
    </span>
  );
}

/**
 * Payment step of a paid application: instructions (from admin Settings),
 * proof upload, and the history of submissions with review outcomes.
 */
export function PaymentSection({ app, onChanged }: { app: MyApplicationDetailDto; onChanged: () => void }) {
  const { locale, t } = useI18n();
  const [info, setInfo] = useState<PaymentInstructionsDto | null>(null);
  const [payments, setPayments] = useState<MyPaymentDto[]>([]);
  const [googleEmail, setGoogleEmail] = useState<string | null>(null);
  const canSubmit = app.status === 'AWAITING_PAYMENT' || app.status === 'PAYMENT_REJECTED';

  const [method, setMethod] = useState<string>('INSTAPAY');
  const [amount, setAmount] = useState('');
  const [transactionRef, setRef] = useState('');
  const [senderName, setSenderName] = useState('');
  const [senderPhone, setSenderPhone] = useState('');
  const [paidAt, setPaidAt] = useState(localToday);
  const [loadError, setLoadError] = useState(false);
  const [file, setFile] = useState<File | null>(null);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [formError, setFormError] = useState<string | null>(null);
  const [attempt, setAttempt] = useState(0);
  const [busy, setBusy] = useState(false);
  const fileInput = useRef<HTMLInputElement>(null);

  const load = useCallback(() => {
    setLoadError(false);
    api<PaymentInstructionsDto>(`/me/applications/${app.id}/payment-instructions`)
      .then((i) => {
        setInfo(i);
        setAmount((a) => a || String(i.amount));
        // Deep links (#payment-title from the dashboard) can only scroll once this has rendered.
        if (window.location.hash === '#payment-title') {
          requestAnimationFrame(() => document.getElementById('payment-title')?.scrollIntoView({ block: 'start' }));
        }
      })
      .catch(() => setLoadError(true));
    api<MyPaymentDto[]>(`/me/applications/${app.id}/payments`).then(setPayments).catch(() => undefined);
    api<ProfileDto>('/me/profile')
      .then((p) => setGoogleEmail(p.googleEmail))
      .catch(() => undefined);
  }, [app.id]);
  useEffect(load, [load]);

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setFormError(null);
    const fields = { method, amount, transactionRef, senderName, senderPhone, paidAt };
    const parsed = paymentProofSchema.safeParse(fields);
    const fileError = !file
      ? t('payment.errors.FILE_REQUIRED')
      : file.size > MAX
        ? t('payment.errors.FILE_TOO_LARGE')
        : file.type && !ACCEPT.includes(file.type)
          ? t('payment.errors.FILE_TYPE')
          : null;
    const next = parsed.success ? {} : issuesToErrors(parsed.error.issues, t);
    if (fileError) next.screenshot = fileError;
    if (Object.keys(next).length) {
      setErrors(next);
      setFormError(t('forms.fixErrors'));
      setAttempt((n) => n + 1);
      requestAnimationFrame(() => document.querySelector<HTMLElement>('#payment-form [aria-invalid="true"]')?.focus());
      return;
    }
    setErrors({});
    const body = new FormData();
    for (const [k, v] of Object.entries(fields)) body.append(k, v);
    body.append('screenshot', file!);
    setBusy(true);
    try {
      await api(`/me/applications/${app.id}/payments`, { method: 'POST', body });
      setFile(null);
      if (fileInput.current) fileInput.current.value = '';
      load();
      onChanged();
    } catch (err) {
      const code = err instanceof ApiError ? err.code : undefined;
      if (err instanceof ApiError && err.errors.length) {
        setErrors(Object.fromEntries(err.errors.map((x) => [x.path, t('forms.errors.invalid')])));
      }
      const known = code ? t(`payment.errors.${code}`) : '';
      setFormError(known && known !== `payment.errors.${code}` ? known : errorMessage(err, t));
      setAttempt((n) => n + 1);
    } finally {
      setBusy(false);
    }
  }

  if (loadError) {
    return (
      <Alert tone="danger" className="mt-8">
        {t('errors.generic')}{' '}
        <button type="button" className="font-semibold underline" onClick={load}>
          {t('payment.retry')}
        </button>
      </Alert>
    );
  }
  if (!info) return null;
  const due = formatMoney(info.amount, info.currency, locale);
  const [termsBefore, termsMiddle, termsAfter] = t('payment.policyNote').split(/\{terms\}|\{refund\}/);

  return (
    <section aria-labelledby="payment-title" className="mt-8 space-y-5">
      <h2 id="payment-title" className="text-xl">
        {t('payment.title')}
      </h2>

      {canSubmit && (
        <div className="rounded-card border border-accent/40 bg-accent-soft/40 p-5">
          <p className="text-sm text-muted">{t('payment.amountDue')}</p>
          <p className="text-3xl font-bold text-fg">{due}</p>
          <h3 className="mt-4 text-base">{t('payment.howTo')}</h3>
          <ol className="mt-2 list-decimal space-y-1 ps-5 text-sm">
            <li>{t('payment.step1', { amount: due })}</li>
            <li>{t('payment.step2')}</li>
            <li>{t('payment.step3')}</li>
          </ol>
          <div className="mt-4 grid gap-4 sm:grid-cols-2">
            <div className="rounded-lg border border-line bg-card p-4">
              <p className="font-semibold text-fg">{t('payment.instapay')}</p>
              <p className="mt-2 text-xs text-muted">{t('payment.handle')}</p>
              <CopyValue value={info.instapayHandle} />
              <p className="mt-2 text-xs text-muted">{t('payment.accountName')}</p>
              <p className="text-sm">{info.instapayName}</p>
            </div>
            <div className="rounded-lg border border-line bg-card p-4">
              <p className="font-semibold text-fg">{t('payment.vodafone')}</p>
              <p className="mt-2 text-xs text-muted">{t('payment.number')}</p>
              <CopyValue value={info.vodafoneCashNumber} />
              <p className="mt-2 text-xs text-muted">{t('payment.accountName')}</p>
              <p className="text-sm">{info.vodafoneCashName}</p>
            </div>
          </div>
          {googleEmail && (
            <Alert tone="info" className="mt-4">
              {t('payment.driveNote', { email: googleEmail })}{' '}
              <Link href={`/${locale}/profile?tab=core`} className="font-semibold underline">
                {t('common.edit')}
              </Link>
            </Alert>
          )}
          <p className="mt-3 text-xs text-muted">
            {termsBefore}
            <Link href={`/${locale}/terms`} className="underline">
              {t('footer.terms')}
            </Link>
            {termsMiddle}
            <Link href={`/${locale}/refund-policy`} className="underline">
              {t('footer.refund')}
            </Link>
            {termsAfter}
          </p>
        </div>
      )}

      {app.status === 'PAYMENT_SUBMITTED' && <Alert tone="success">{t('payment.submitted')}</Alert>}

      {canSubmit && !info.configured && <Alert tone="warning">{t('payment.notConfigured', { email: info.supportEmail })}</Alert>}

      {canSubmit && info.configured && (
        <form id="payment-form" onSubmit={onSubmit} noValidate className="space-y-5 rounded-card border border-line bg-card p-5 sm:p-6">
          <h3 className="text-lg">{t('payment.formTitle')}</h3>
          {formError && (
            <Alert key={attempt} tone="danger">
              {formError}
            </Alert>
          )}
          <RadioGroup
            legend={t('payment.method')}
            required
            value={method}
            onChange={setMethod}
            options={(['INSTAPAY', 'VODAFONE_CASH'] as const).map((m) => ({ value: m, label: paymentMethodLabels[m][locale] }))}
            error={errors.method}
          />
          <div className="grid gap-5 sm:grid-cols-2">
            <TextField label={t('payment.amount')} required type="number" inputMode="numeric" min={1} value={amount} onChange={setAmount} error={errors.amount} />
            <TextField label={t('payment.paidAt')} required type="date" value={paidAt} onChange={setPaidAt} error={errors.paidAt} max={localToday()} />
            <TextField
              label={t('payment.transactionRef')}
              hint={t('payment.transactionRefHint')}
              required
              dir="ltr"
              autoComplete="off"
              value={transactionRef}
              onChange={setRef}
              error={errors.transactionRef}
            />
            <TextField label={t('payment.senderName')} required value={senderName} onChange={setSenderName} error={errors.senderName} />
            <TextField label={t('payment.senderPhone')} required dir="ltr" value={senderPhone} onChange={setSenderPhone} error={errors.senderPhone} />
          </div>
          <div>
            <label htmlFor="payment-file" className="mb-1.5 block text-sm font-semibold text-fg">
              {t('payment.screenshot')} <span className="text-danger" aria-hidden>*</span>
            </label>
            <input
              id="payment-file"
              ref={fileInput}
              type="file"
              accept="image/jpeg,image/png,application/pdf"
              onChange={(e) => setFile(e.target.files?.[0] ?? null)}
              aria-invalid={errors.screenshot ? true : undefined}
              aria-required="true"
              aria-describedby={errors.screenshot ? 'payment-file-hint payment-file-error' : 'payment-file-hint'}
              className="block w-full text-sm file:me-3 file:min-h-10 file:rounded-lg file:border-0 file:bg-ink file:px-4 file:font-semibold file:text-white"
            />
            <p id="payment-file-hint" className="mt-1 text-xs text-muted">
              🔒 {t('payment.screenshotHint')}
            </p>
            {errors.screenshot && (
              <p id="payment-file-error" className="mt-1 text-sm font-medium text-danger">
                {errors.screenshot}
              </p>
            )}
          </div>
          <Button type="submit" size="lg" variant="accent" loading={busy}>
            {t('payment.submit')}
          </Button>
        </form>
      )}

      {payments.length > 0 && (
        <div>
          <h3 className="text-base">{t('payment.history')}</h3>
          <ul className="mt-3 divide-y divide-line rounded-card border border-line bg-card">
            {payments.map((p) => (
              <li key={p.id} className="flex flex-wrap items-start justify-between gap-2 p-4 text-sm">
                <div>
                  <p className="font-semibold text-fg">
                    {paymentMethodLabels[p.method][locale]} · {formatMoney(p.amount, p.currency, locale)}
                  </p>
                  <p className="text-xs text-muted">
                    <span className="ltr-embed">{p.transactionRef}</span> · {formatDate(p.paidAt, locale)}
                  </p>
                  {p.rejectionReason && <p className="mt-1 text-danger">{t('payment.rejectedReason', { reason: p.rejectionReason })}</p>}
                </div>
                <Badge tone={p.status === 'APPROVED' ? 'success' : p.status === 'REJECTED' ? 'danger' : 'info'}>
                  {paymentStatusLabels[p.status][locale]}
                </Badge>
              </li>
            ))}
          </ul>
        </div>
      )}
      <p className="text-xs text-muted">{t('payment.help', { email: info.supportEmail })}</p>
    </section>
  );
}
