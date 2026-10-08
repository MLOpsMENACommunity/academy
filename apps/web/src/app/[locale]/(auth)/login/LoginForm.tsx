'use client';

import type { MeResponse } from '@academy/shared';
import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { useEffect, useState, type FormEvent } from 'react';
import { AuthCard } from '@/components/auth/AuthCard';
import { useAuth } from '@/components/auth/AuthProvider';
import { GoogleButton } from '@/components/auth/GoogleButton';
import { TextField } from '@/components/forms/fields';
import { Alert } from '@/components/ui/Alert';
import { Button } from '@/components/ui/Button';
import { useI18n } from '@/i18n/client';
import { api } from '@/lib/api';
import { errorMessage } from '@/lib/errors';
import { useReturnTo, withReturnTo } from '@/lib/use-return-to';

/** Where to go after sign-in: onboarding first if the required profile is incomplete. */
export function postLoginPath(me: MeResponse, locale: string, returnTo: string): string {
  if (me.role === 'ADMIN') return returnTo;
  return me.profile.coreComplete ? returnTo : withReturnTo(`/${locale}/onboarding`, returnTo);
}

export function LoginForm() {
  const { locale, t } = useI18n();
  const { user, setUser } = useAuth();
  const router = useRouter();
  const returnTo = useReturnTo();
  const params = useSearchParams();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(() => {
    const code = params.get('error');
    return code ? t(`auth.errors.${code}`) : null;
  });
  const [busy, setBusy] = useState(false);

  // Already signed in (e.g. a valid refresh cookie): continue straight away.
  useEffect(() => {
    if (user) router.replace(postLoginPath(user, locale, returnTo));
  }, [user, router, locale, returnTo]);

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const me = await api<MeResponse>('/auth/login', { method: 'POST', json: { email, password } });
      setUser(me);
      router.replace(postLoginPath(me, locale, returnTo));
    } catch (err) {
      setError(errorMessage(err, t));
      setBusy(false);
    }
  }

  return (
    <AuthCard title={t('auth.loginTitle')} subtitle={t('auth.loginSubtitle')}>
      <GoogleButton returnTo={returnTo} />
      <form onSubmit={onSubmit} className="space-y-4" noValidate>
        {error && (
          <Alert tone="danger">
            {error}
            {error === t('auth.errors.INVALID_CREDENTIALS') && <p className="mt-1 text-xs">{t('auth.googleHint')}</p>}
          </Alert>
        )}
        <TextField label={t('auth.email')} type="email" autoComplete="email" required value={email} onChange={setEmail} />
        <TextField
          label={t('auth.password')}
          type="password"
          autoComplete="current-password"
          required
          value={password}
          onChange={setPassword}
        />
        <div className="text-end text-sm">
          <Link href={`/${locale}/forgot-password`} className="text-primary hover:underline">
            {t('auth.forgot')}
          </Link>
        </div>
        <Button type="submit" size="lg" className="w-full" loading={busy}>
          {t('auth.loginCta')}
        </Button>
      </form>
      <p className="mt-6 text-center text-sm text-muted">
        {t('auth.noAccount')}{' '}
        <Link href={withReturnTo(`/${locale}/register`, returnTo)} className="font-semibold text-primary hover:underline">
          {t('nav.register')}
        </Link>
      </p>
    </AuthCard>
  );
}
