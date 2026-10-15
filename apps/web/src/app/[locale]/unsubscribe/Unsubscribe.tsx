'use client';

import type { EmailOptOutDto } from '@academy/shared';
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
 * Stopping takes a click (a POST): mail scanners open links in emails, and opening the link
 * alone must not change anything. Mail apps' own "Unsubscribe" button posts to the API directly.
 */
export function Unsubscribe() {
  const { locale, t } = useI18n();
  const token = useSearchParams().get('token') ?? '';
  const [info, setInfo] = useState<EmailOptOutDto | null>(null);
  const [state, setState] = useState<'loading' | 'ready' | 'stopped' | 'resumed' | 'invalid'>(token ? 'loading' : 'invalid');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!token) return;
    api<EmailOptOutDto>(`/email/unsubscribe?token=${encodeURIComponent(token)}`)
      .then((r) => {
        setInfo(r);
        setState(r.subscribed ? 'ready' : 'stopped');
      })
      .catch(() => setState('invalid'));
  }, [token]);

  async function change(on: boolean) {
    setError(null);
    setBusy(true);
    try {
      const r = await api<EmailOptOutDto>(on ? '/email/unsubscribe/undo' : '/email/unsubscribe', { method: 'POST', json: { token } });
      setInfo(r);
      setState(on ? 'resumed' : 'stopped');
    } catch (err) {
      setError(errorMessage(err, t));
    } finally {
      setBusy(false);
    }
  }

  const course = info ? (locale === 'ar' && info.course.titleAr) || info.course.titleEn : '';
  const feedback = info?.kind === 'feedback';

  return (
    <Container className="max-w-xl py-14 sm:py-20">
      <h1 className="text-[1.75rem] leading-tight sm:text-3xl">{t('emailOptOut.title')}</h1>
      <div className="mt-5 space-y-5" aria-live="polite">
        {state === 'loading' && <p className="text-muted">{t('common.loading')}</p>}
        {state === 'invalid' && <Alert tone="danger">{t('emailOptOut.invalid')}</Alert>}
        {state === 'ready' && (
          <>
            <p className="leading-relaxed">{t(feedback ? 'emailOptOut.confirmFeedback' : 'emailOptOut.confirmReminders', { course })}</p>
            {error && <Alert tone="danger">{error}</Alert>}
            <Button variant="accent" size="lg" className="w-full sm:w-auto" loading={busy} onClick={() => change(false)}>
              {t('emailOptOut.stop')}
            </Button>
          </>
        )}
        {state === 'stopped' && (
          <>
            <Alert tone="success">{t(feedback ? 'emailOptOut.stoppedFeedback' : 'emailOptOut.stoppedReminders', { course })}</Alert>
            {error && <Alert tone="danger">{error}</Alert>}
            <Button variant="secondary" size="md" loading={busy} onClick={() => change(true)}>
              {t('emailOptOut.undo')}
            </Button>
          </>
        )}
        {state === 'resumed' && <Alert tone="success">{t('emailOptOut.resumed', { course })}</Alert>}
        {info && (
          <Link href={`/${locale}/learn/${info.course.slug}`} className={`${buttonClass('secondary', 'md')} ${state === 'stopped' ? 'ms-3' : ''}`}>
            {t('emailOptOut.toCourse')}
          </Link>
        )}
      </div>
    </Container>
  );
}
