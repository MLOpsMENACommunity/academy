'use client';

import { useEffect, useState, useSyncExternalStore } from 'react';
import { useI18n } from '@/i18n/client';
import { hasSessionCookie } from '@/lib/api';
import { forwardTo } from '@/lib/forward';
import { Alert } from '../ui/Alert';
import { buttonClass } from '../ui/Button';
import { PageSpinner } from '../ui/Spinner';

const noSubscribe = () => () => {};

/**
 * True when the browser holds a session cookie. False in the server HTML and during hydration
 * (the login and register pages are static), then the real value.
 */
export function useHasSessionCookie(): boolean {
  return useSyncExternalStore(noSubscribe, hasSessionCookie, () => false);
}

/**
 * What the login and register pages show to someone who is signed in: a spinner while a full
 * page load takes them to `target` (see lib/forward.ts). If that keeps landing back here, a
 * plain link instead of another reload.
 */
export function SignedInForward({ target }: { target: string }) {
  const { t } = useI18n();
  const [stuck, setStuck] = useState(false);

  useEffect(() => {
    if (!forwardTo(target)) setStuck(true);
  }, [target]);

  if (!stuck) return <PageSpinner />;
  return (
    <div className="mx-auto w-full max-w-md py-12">
      <Alert tone="info" title={t('auth.signedIn.title')}>
        <p>{t('auth.signedIn.body')}</p>
        {/* A plain <a> on purpose: a full page load, never the client router's cached redirect. */}
        <a href={target} className={buttonClass('primary', 'lg', 'mt-4 w-full')}>
          {t('auth.signedIn.continue')}
        </a>
      </Alert>
    </div>
  );
}
