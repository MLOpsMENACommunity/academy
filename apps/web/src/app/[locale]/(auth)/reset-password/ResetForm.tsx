'use client';

import { resetPasswordSchema } from '@academy/shared';
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
import { isInvalidTokenError, resetTokenLooksValid } from '@/lib/reset-password';
import { issuesToErrors } from '@/lib/zod-errors';

export function ResetForm() {
  const { locale, t } = useI18n();
  const token = useSearchParams().get('token') ?? '';
  const [password, setPassword] = useState('');
  const [done, setDone] = useState(false);
  // A missing or malformed link never shows the form; a used or expired one switches to this after submit.
  const [linkInvalid, setLinkInvalid] = useState(!resetTokenLooksValid(token));
  const [passwordError, setPasswordError] = useState<string | undefined>();
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    const check = resetPasswordSchema.shape.password.safeParse(password);
    if (!check.success) {
      setPasswordError(issuesToErrors(check.error.issues, t)['']);
      return;
    }
    setPasswordError(undefined);
    setBusy(true);
    try {
      await api('/auth/reset-password', { method: 'POST', json: { token, password } });
      setDone(true);
    } catch (err) {
      if (isInvalidTokenError(err)) setLinkInvalid(true);
      else setError(errorMessage(err, t));
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
      ) : linkInvalid ? (
        <div className="space-y-4">
          <Alert tone="danger">{t('auth.errors.TOKEN_INVALID')}</Alert>
          <Link href={`/${locale}/forgot-password`} className={buttonClass('primary', 'lg', 'w-full')}>
            {t('auth.resetInvalidCta')}
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
            error={passwordError}
            value={password}
            onChange={setPassword}
          />
          <Button type="submit" size="lg" className="w-full" loading={busy}>
            {t('auth.resetCta')}
          </Button>
        </form>
      )}
    </AuthCard>
  );
}
