'use client';

import { useEffect, useState } from 'react';
import { useI18n } from '@/i18n/client';
import { buttonClass } from '../ui/Button';

/** Full-page navigation to the API, which redirects to Google and back. */
export function GoogleButton({ returnTo }: { returnTo: string }) {
  const { locale, t } = useI18n();
  const [enabled, setEnabled] = useState<boolean | null>(null);
  useEffect(() => {
    fetch('/api/auth/google/enabled')
      .then((r) => r.json())
      .then((d: { enabled: boolean }) => setEnabled(d.enabled))
      .catch(() => setEnabled(false));
  }, []);
  if (enabled === false) return null;
  const href = `/api/auth/google?locale=${locale}&returnTo=${encodeURIComponent(returnTo)}`;
  return (
    <>
      <a href={href} className={buttonClass('secondary', 'lg', 'w-full')} aria-disabled={enabled === null}>
        <svg aria-hidden viewBox="0 0 24 24" className="size-5">
          <path fill="#EA4335" d="M12 10.2v3.9h5.5c-.2 1.3-1.6 3.9-5.5 3.9-3.3 0-6-2.7-6-6.1s2.7-6.1 6-6.1c1.9 0 3.1.8 3.8 1.5l2.6-2.5C16.8 3.3 14.6 2.3 12 2.3 6.7 2.3 2.4 6.6 2.4 12s4.3 9.7 9.6 9.7c5.5 0 9.2-3.9 9.2-9.4 0-.6-.1-1.1-.2-1.6H12z" />
        </svg>
        {t('auth.google')}
      </a>
      <div className="my-5 flex items-center gap-3 text-xs text-muted" role="separator">
        <span className="h-px flex-1 bg-line" />
        {t('auth.or')}
        <span className="h-px flex-1 bg-line" />
      </div>
    </>
  );
}
