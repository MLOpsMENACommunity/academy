'use client';

import { useState } from 'react';
import { useI18n } from '@/i18n/client';
import { api } from '@/lib/api';
import { useAuth } from './AuthProvider';

/** Site-wide nudge until the login email is confirmed. */
export function VerifyBanner() {
  const { user } = useAuth();
  const { t } = useI18n();
  const [sent, setSent] = useState<'idle' | 'sent' | 'error'>('idle');
  if (!user || user.emailVerified) return null;
  return (
    <div className="border-b border-warning/30 bg-warning-soft text-warning" role="status">
      <div className="mx-auto flex max-w-[75rem] flex-wrap items-center gap-x-3 gap-y-1 px-5 py-2 text-sm sm:px-6 lg:px-10">
        <span>
          {/* <bdi> keeps the LTR address intact inside the Arabic sentence. */}
          {t('auth.verifyBanner', { email: '\u0000' })
            .split('\u0000')
            .flatMap((part, i) => (i === 0 ? [part] : [<bdi key={i}>{user.email}</bdi>, part]))}
        </span>
        {sent === 'sent' ? (
          <span className="font-semibold">{t('auth.resent')}</span>
        ) : (
          <button
            type="button"
            className="min-h-9 font-semibold underline"
            onClick={() =>
              api('/auth/resend-verification', { method: 'POST' })
                .then(() => setSent('sent'))
                .catch(() => setSent('error'))
            }
          >
            {t('auth.resend')}
          </button>
        )}
        {sent === 'error' && <span className="font-semibold text-danger">{t('errors.generic')}</span>}
      </div>
    </div>
  );
}
