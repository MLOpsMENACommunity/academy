'use client';

import { safeReturnTo } from '@academy/shared';
import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import { useEffect, useRef, useState } from 'react';
import { AuthCard } from '@/components/auth/AuthCard';
import { useAuth } from '@/components/auth/AuthProvider';
import { RequireAuth } from '@/components/auth/RequireAuth';
import { Alert } from '@/components/ui/Alert';
import { buttonClass } from '@/components/ui/Button';
import { useI18n } from '@/i18n/client';
import { api } from '@/lib/api';
import { errorMessage } from '@/lib/errors';

/** Verification needs the account's own session (see the API); RequireAuth sends visitors to login and back. */
export function VerifyEmail() {
  return <RequireAuth>{() => <Inner />}</RequireAuth>;
}

function Inner() {
  const { locale, t } = useI18n();
  const { reload } = useAuth();
  const token = useSearchParams().get('token');
  const [state, setState] = useState<'pending' | 'done' | 'error'>(token ? 'pending' : 'error');
  const [error, setError] = useState<string>(t('auth.verifyFailed'));
  const [next, setNext] = useState(`/${locale}/dashboard`);
  const ran = useRef(false);

  useEffect(() => {
    if (!token || ran.current) return; // strict mode runs effects twice; tokens are single-use
    ran.current = true;
    api<{ returnTo: string | null }>('/auth/verify-email', { method: 'POST', json: { token } })
      .then((r) => {
        setNext(safeReturnTo(r.returnTo, `/${locale}/dashboard`));
        setState('done');
        void reload();
      })
      .catch((err: unknown) => {
        setError(errorMessage(err, t));
        setState('error');
      });
  }, [token, locale, t, reload]);

  return (
    <AuthCard title={state === 'pending' ? t('auth.verifyTitle') : state === 'done' ? t('auth.verifyDone') : t('auth.verifyFailed')}>
      {state === 'pending' && <p className="text-muted">{t('common.loading')}</p>}
      {state === 'error' && <Alert tone="danger">{error}</Alert>}
      {state === 'done' && (
        <Link href={next} className={buttonClass('primary', 'lg', 'w-full')}>
          {t('auth.continue')}
        </Link>
      )}
    </AuthCard>
  );
}
