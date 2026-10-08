'use client';

import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import { useState, type FormEvent } from 'react';
import { AuthCard } from '@/components/auth/AuthCard';
import { TextField } from '@/components/forms/fields';
import { Alert } from '@/components/ui/Alert';
import { Button, buttonClass } from '@/components/ui/Button';
import { useI18n } from '@/i18n/client';
import { api } from '@/lib/api';
import { errorMessage } from '@/lib/errors';

export function ResetForm() {
  const { locale, t } = useI18n();
  const token = useSearchParams().get('token') ?? '';
  const [password, setPassword] = useState('');
  const [done, setDone] = useState(false);
  const [error, setError] = useState<string | null>(token ? null : t('auth.errors.TOKEN_INVALID'));
  const [busy, setBusy] = useState(false);

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await api('/auth/reset-password', { method: 'POST', json: { token, password } });
      setDone(true);
    } catch (err) {
      setError(errorMessage(err, t));
    } finally {
      setBusy(false);
    }
  }

  return (
    <AuthCard title={t('auth.resetTitle')}>
      {done ? (
        <div className="space-y-4">
          <Alert tone="success">{t('auth.resetDone')}</Alert>
          <Link href={`/${locale}/login`} className={buttonClass('primary', 'lg', 'w-full')}>
            {t('nav.login')}
          </Link>
        </div>
      ) : (
        <form onSubmit={onSubmit} className="space-y-4" noValidate>
          {error && <Alert tone="danger">{error}</Alert>}
          <TextField
            label={t('auth.newPassword')}
            type="password"
            autoComplete="new-password"
            required
            minLength={10}
            hint={t('auth.passwordHint')}
            value={password}
            onChange={setPassword}
          />
          <Button type="submit" size="lg" className="w-full" loading={busy} disabled={!token}>
            {t('auth.resetCta')}
          </Button>
        </form>
      )}
    </AuthCard>
  );
}
