'use client';

import { CONSULTATION_WALLET_LABELS, type ConsultantDetailDto, type ConsultationPaymentDto, type ConsultationWallet, type MyConsultationDto } from '@academy/shared';
import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { useEffect, useState, type FormEvent } from 'react';
import { useAuth } from '@/components/auth/AuthProvider';
import { TextAreaField, TextField } from '@/components/forms/fields';
import { Alert } from '@/components/ui/Alert';
import { Button, buttonClass } from '@/components/ui/Button';
import { Card } from '@/components/ui/Card';
import { useI18n } from '@/i18n/client';
import { api } from '@/lib/api';
import { errorMessage } from '@/lib/errors';
import { egp } from './shared';
import { SlotPicker } from './SlotPicker';

const MAX_BYTES = 5 * 1024 * 1024;
const ACCEPT = ['image/jpeg', 'image/png', 'application/pdf'];

/**
 * Pay first, then book: the expert's open times (to see before paying), then paying for a call
 * length: send the price by a wallet and upload the transfer screenshot. The academy checks it,
 * and the student books a time once it's approved.
 */
export function BookingPanel({ expert }: { expert: ConsultantDetailDto }) {
  const { locale, t } = useI18n();
  const { user, loading: authLoading } = useAuth();
  const router = useRouter();
  const here = usePathname() ?? `/${locale}/consultations/${expert.slug}`;
  const lengths = ([30, 60] as const).filter((m) => (m === 30 ? expert.price30Egp : expert.price60Egp) !== null);
  const [duration, setDuration] = useState<30 | 60>(lengths[0] ?? 30);
  const [payment, setPayment] = useState<ConsultationPaymentDto | null>(null);
  const [method, setMethod] = useState<ConsultationWallet | null>(null);
  const [ref, setRef] = useState('');
  const [note, setNote] = useState('');
  const [file, setFile] = useState<File | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const price = duration === 30 ? expert.price30Egp : expert.price60Egp;

  useEffect(() => {
    if (!user) return;
    api<ConsultationPaymentDto>('/consultations/payment')
      .then((p) => {
        setPayment(p);
        setMethod(p.methods[0]?.kind ?? null);
      })
      .catch(() => setPayment({ methods: [], supportWhatsapp: '' }));
  }, [user]);

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (!method) return;
    const problem = !file ? 'FILE_REQUIRED' : file.size > MAX_BYTES ? 'FILE_TOO_LARGE' : file.type && !ACCEPT.includes(file.type) ? 'FILE_TYPE' : null;
    if (problem) {
      setError(t(`payment.errors.${problem}`));
      return;
    }
    const body = new FormData();
    body.append('durationMin', String(duration));
    body.append('method', method);
    body.append('transactionRef', ref);
    body.append('note', note);
    body.append('screenshot', file!);
    setBusy(true);
    setError(null);
    try {
      const b = await api<MyConsultationDto>(`/consultations/experts/${expert.slug}/purchases`, { method: 'POST', body });
      router.push(`/${locale}/consultations/bookings/${b.id}`);
    } catch (err) {
      setError(errorMessage(err, t));
      setBusy(false);
    }
  }

  const chip = (on: boolean) => `min-h-11 flex-1 rounded-xl border px-3 text-[0.9375rem] ${on ? 'border-primary bg-primary-soft font-medium text-primary' : 'border-line text-body hover:bg-muted-bg'}`;

  return (
    <Card className="flex h-fit flex-col gap-5 p-5 lg:sticky lg:top-6">
      <h2 className="text-[1.25rem]">{t('consultations.expert.bookTitle')}</h2>

      {lengths.length > 1 && (
        <fieldset>
          <legend className="text-[0.9375rem] font-medium text-fg">{t('consultations.expert.length')}</legend>
          <div className="mt-2 flex gap-2">
            {lengths.map((m) => (
              <button key={m} type="button" aria-pressed={duration === m} onClick={() => setDuration(m)} className={chip(duration === m)}>
                {t('consultations.minutes', { min: m })}
              </button>
            ))}
          </div>
        </fieldset>
      )}
      {price !== null && <p className="text-[0.9375rem] text-body">{t('consultations.expert.price', { price: egp(price, locale), min: duration })}</p>}

      <section aria-labelledby="open-times" className="flex flex-col gap-3">
        <h3 id="open-times" className="font-medium text-fg">
          {t('consultations.expert.openTimes')}
        </h3>
        <p className="text-[0.8125rem] text-muted">{t('consultations.expert.openTimesHint')}</p>
        <SlotPicker url={`/consultations/experts/${expert.slug}/slots?duration=${duration}`} horizonDays={expert.horizonDays} />
      </section>

      {authLoading ? null : !user ? (
        <Link href={`/${locale}/login?returnTo=${encodeURIComponent(here)}`} className={buttonClass('accent', 'lg', 'w-full')}>
          {t('consultations.expert.signIn')}
        </Link>
      ) : !payment ? null : payment.methods.length === 0 ? (
        <Alert tone="info">{t('consultations.expert.paymentsClosed')}</Alert>
      ) : (
        <form onSubmit={(e) => void submit(e)} className="flex flex-col gap-4 border-t border-line pt-5">
          <h3 className="font-medium text-fg">{t('consultations.expert.payTitle', { price: price !== null ? egp(price, locale) : '' })}</h3>
          <fieldset>
            <legend className="text-[0.9375rem] text-body">{t('consultations.expert.payHow')}</legend>
            <ul className="mt-2 flex flex-col gap-2">
              {payment.methods.map((m) => (
                <li key={m.kind}>
                  <label className={`flex cursor-pointer items-start gap-3 rounded-xl border p-3 ${method === m.kind ? 'border-primary bg-primary-soft' : 'border-line'}`}>
                    <input type="radio" name="method" className="mt-1" checked={method === m.kind} onChange={() => setMethod(m.kind)} />
                    <span>
                      <span className="block font-medium text-fg">{CONSULTATION_WALLET_LABELS[m.kind][locale]}</span>
                      <span dir="ltr" className="block text-body tabular-nums select-all">
                        {m.handle}
                      </span>
                      {m.name && <span className="block text-[0.8125rem] text-muted">{t('consultations.booking.payName', { name: m.name })}</span>}
                    </span>
                  </label>
                </li>
              ))}
            </ul>
          </fieldset>
          <TextField label={t('consultations.expert.reference')} hint={t('consultations.expert.referenceHint')} dir="ltr" value={ref} onChange={setRef} maxLength={100} />
          <div>
            <label htmlFor="consultation-proof" className="mb-1.5 block text-sm font-semibold text-fg">
              {t('payment.screenshot')} <span className="text-danger" aria-hidden>*</span>
            </label>
            <input
              id="consultation-proof"
              type="file"
              accept="image/jpeg,image/png,application/pdf"
              aria-required="true"
              aria-describedby="consultation-proof-hint"
              onChange={(e) => setFile(e.target.files?.[0] ?? null)}
              className="block w-full text-sm file:me-3 file:min-h-11 file:rounded-full file:border-0 file:bg-ink file:px-5 file:font-medium file:text-white"
            />
            <p id="consultation-proof-hint" className="mt-1 text-xs text-muted">
              🔒 {t('payment.screenshotHint')}
            </p>
          </div>
          <TextAreaField label={t('consultations.expert.note')} hint={t('consultations.expert.noteHint')} value={note} onChange={setNote} maxLength={1000} rows={3} />
          {error && <Alert tone="danger">{error}</Alert>}
          <Button type="submit" variant="accent" size="lg" loading={busy} disabled={!method}>
            {t('consultations.expert.submitPayment')}
          </Button>
          <p className="text-[0.8125rem] leading-relaxed text-muted">{t('consultations.expert.afterPay')}</p>
        </form>
      )}
    </Card>
  );
}
