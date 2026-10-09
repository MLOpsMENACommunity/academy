'use client';

import type { WaitlistLeaveResult } from '@academy/shared';
import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import { useEffect, useState } from 'react';
import { Alert } from '@/components/ui/Alert';
import { Button, buttonClass } from '@/components/ui/Button';
import { Container } from '@/components/ui/Container';
import { useI18n } from '@/i18n/client';
import { api } from '@/lib/api';
import { errorMessage } from '@/lib/errors';

/**
 * Leaving takes a click (a POST): mail scanners open links in emails, and opening the
 * link alone must not take anyone off the list.
 */
export function LeaveWaitlist() {
  const { locale, t } = useI18n();
  const token = useSearchParams().get('token') ?? '';
  const [info, setInfo] = useState<WaitlistLeaveResult | null>(null);
  const [state, setState] = useState<'loading' | 'ready' | 'done' | 'invalid'>(token ? 'loading' : 'invalid');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!token) return;
    api<WaitlistLeaveResult>(`/waitlist/leave?token=${encodeURIComponent(token)}`)
      .then((r) => {
        setInfo(r);
        setState(r.left ? 'done' : 'ready');
      })
      .catch(() => setState('invalid'));
  }, [token]);

  async function leave() {
    setError(null);
    setBusy(true);
    try {
      const r = await api<WaitlistLeaveResult>('/waitlist/leave', { method: 'POST', json: { token } });
      setInfo((prev) => ({ left: true, course: r.course ?? prev?.course ?? null }));
      setState('done');
    } catch (err) {
      setError(errorMessage(err, t));
    } finally {
      setBusy(false);
    }
  }

  const course = info?.course ? (locale === 'ar' && info.course.titleAr) || info.course.titleEn : null;

  return (
    <Container className="max-w-xl py-14 sm:py-20">
      <h1 className="text-[1.75rem] leading-tight sm:text-3xl">{t('waitlist.leaveTitle')}</h1>
      <div className="mt-5 space-y-5" aria-live="polite">
        {state === 'loading' && <p className="text-muted">{t('common.loading')}</p>}
        {state === 'invalid' && <Alert tone="danger">{t('waitlist.invalidLink')}</Alert>}
        {state === 'ready' && (
          <>
            <p className="leading-relaxed">{course ? t('waitlist.leaveConfirm', { course }) : t('waitlist.leaveConfirmGeneric')}</p>
            {error && <Alert tone="danger">{error}</Alert>}
            <Button variant="accent" size="lg" className="w-full sm:w-auto" loading={busy} onClick={leave}>
              {t('waitlist.leaveButton')}
            </Button>
          </>
        )}
        {state === 'done' && (
          <Alert tone="success">{course ? t('waitlist.leftCourse', { course }) : t('waitlist.left')}</Alert>
        )}
        {state !== 'loading' && (
          <Link href={info?.course ? `/${locale}/courses/${info.course.slug}` : `/${locale}/courses`} className={buttonClass('secondary', 'md')}>
            {info?.course ? t('waitlist.backToCourse') : t('waitlist.browse')}
          </Link>
        )}
      </div>
    </Container>
  );
}
