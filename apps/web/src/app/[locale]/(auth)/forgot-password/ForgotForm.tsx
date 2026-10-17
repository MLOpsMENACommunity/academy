'use client';

import { forgotPasswordSchema } from '@academy/shared';
import { useState, type FormEvent } from 'react';
import { AuthCard } from '@/components/auth/AuthCard';
import { TextField } from '@/components/forms/fields';
import { Alert } from '@/components/ui/Alert';
import { Button } from '@/components/ui/Button';
import { useI18n } from '@/i18n/client';
import { api } from '@/lib/api';
import { errorMessage } from '@/lib/errors';
import { issuesToErrors } from '@/lib/zod-errors';

export function ForgotForm() {
  const { locale, t } = useI18n();
  const [email, setEmail] = useState('');
  const [sent, setSent] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [emailError, setEmailError] = useState<string | undefined>();
  const [busy, setBusy] = useState(false);

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    const parsed = forgotPasswordSchema.safeParse({ email, locale });
    if (!parsed.success) {
      setEmailError(issuesToErrors(parsed.error.issues, t).email);
      return;
    }
    setEmailError(undefined);
    setBusy(true);
    try {
      await api('/auth/forgot-password', { method: 'POST', json: parsed.data });
      setSent(true);
    } catch (err) {
      setError(errorMessage(err, t));
    } finally {
      setBusy(false);
    }
  }

  return (
    <AuthCard title={t('auth.forgotTitle')} subtitle={t('auth.forgotSubtitle')}>
      {sent ? (
        <Alert tone="success">{t('auth.forgotSent')}</Alert>
      ) : (
        <form onSubmit={onSubmit} className="space-y-4" noValidate>
          {error && <Alert tone="danger">{error}</Alert>}
          <TextField label={t('auth.email')} type="email" autoComplete="email" required value={email} onChange={setEmail} error={emailError} />
          <Button type="submit" size="lg" className="w-full" loading={busy}>
            {t('auth.forgotCta')}
          </Button>
        </form>
      )}
    </AuthCard>
  );
}
