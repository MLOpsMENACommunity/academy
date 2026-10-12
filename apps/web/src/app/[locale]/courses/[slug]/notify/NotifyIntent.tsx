'use client';

import Link from 'next/link';
import { useParams, useRouter } from 'next/navigation';
import { useEffect, useRef, useState } from 'react';
import { RequireAuth } from '@/components/auth/RequireAuth';
import { invalidateCourseStatus } from '@/components/course/ApplyCta';
import { markWaitlistJoined } from '@/components/course/NotifyMe';
import { Alert } from '@/components/ui/Alert';
import { buttonClass } from '@/components/ui/Button';
import { Container } from '@/components/ui/Container';
import { PageSpinner } from '@/components/ui/Spinner';
import { useI18n } from '@/i18n/client';
import { api, ApiError } from '@/lib/api';
import { errorMessage } from '@/lib/errors';

export function NotifyIntent() {
  return <RequireAuth>{(user) => <Inner email={user.email} />}</RequireAuth>;
}

/** Joins the waiting list, then goes back to the course page (which then shows "You're on the waiting list"). */
function Inner({ email }: { email: string }) {
  const { locale, t } = useI18n();
  const router = useRouter();
  const { slug } = useParams<{ slug: string }>();
  const [state, setState] = useState<'pending' | 'verify' | 'error'>('pending');
  const [error, setError] = useState('');
  const ran = useRef(false);
  const course = `/${locale}/courses/${slug}`;

  useEffect(() => {
    if (ran.current) return; // strict mode runs effects twice
    ran.current = true;
    api(`/courses/${slug}/interest`, { method: 'POST', json: { locale } })
      .then(() => {
        markWaitlistJoined(slug);
        invalidateCourseStatus(slug);
        router.replace(course);
      })
      .catch((err: unknown) => {
        // Same rule as applying: the email must be confirmed first. The confirmation link brings them back here.
        if (err instanceof ApiError && err.code === 'EMAIL_NOT_VERIFIED') return setState('verify');
        setError(errorMessage(err, t));
        setState('error');
      });
  }, [slug, locale, course, router, t]);

  if (state === 'pending') return <PageSpinner />;
  return (
    <Container className="max-w-2xl py-10">
      {state === 'verify' ? (
        <Alert tone="warning" title={t('waitlist.verifyFirstTitle')}>
          {t('waitlist.verifyFirst', { email })}
        </Alert>
      ) : (
        <Alert tone="danger">{error}</Alert>
      )}
      <Link href={course} className={buttonClass('secondary', 'md', 'mt-4')}>
        {t('waitlist.backToCourse')}
      </Link>
    </Container>
  );
}
