'use client';

import { loginSchema, type MeResponse, type SignupRole } from '@academy/shared';
import { postLoginPath } from '@/lib/post-login';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useEffect, useState, type FormEvent } from 'react';
import { AuthCard } from '@/components/auth/AuthCard';
import { useAuth } from '@/components/auth/AuthProvider';
import { GoogleButton } from '@/components/auth/GoogleButton';
import { initialSignupRole, RoleChooser } from '@/components/auth/RoleChooser';
import { TextField } from '@/components/forms/fields';
import { Alert } from '@/components/ui/Alert';
import { Button } from '@/components/ui/Button';
import { useI18n } from '@/i18n/client';
import { api } from '@/lib/api';
import { errorMessage, loginErrorMessage } from '@/lib/errors';
import { issuesToErrors } from '@/lib/zod-errors';
import { useReturnTo, withReturnTo } from '@/lib/use-return-to';
import { useHashParam, useSearchParam } from '@/lib/use-search-param';

export { postLoginPath };

export function LoginForm({ googleEnabled }: { googleEnabled?: boolean }) {
  const { locale, t } = useI18n();
  const { user, setUser } = useAuth();
  const router = useRouter();
  const returnTo = useReturnTo();
  const errorCode = useSearchParam('error');
  const asParam = useSearchParam('as');
  const [role, setRole] = useState<SignupRole>('STUDENT');
  useEffect(() => setRole(initialSignupRole(asParam)), [asParam]);
  const [email, setEmail] = useState('');
  // Prefilled from an "Enrol by email" invitation link (#email=…, kept out of server logs); never overwrites typing.
  const emailParam = useHashParam('email');
  useEffect(() => {
    if (emailParam) setEmail((current) => current || emailParam);
  }, [emailParam]);
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);

  // ?error=… (e.g. a failed Google sign-in), read after hydration: the page is static.
  useEffect(() => {
    if (errorCode) setError(loginErrorMessage(errorCode, t));
  }, [errorCode, t]);

  // Already signed in (e.g. a valid refresh cookie): continue straight away.
  useEffect(() => {
    if (user) router.replace(postLoginPath(user, locale, returnTo));
  }, [user, router, locale, returnTo]);

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    // Same rules as the API, in the page's language (the API answers a bad address with "Validation failed").
    const parsed = loginSchema.safeParse({ email, password });
    if (!parsed.success) {
      setFieldErrors(issuesToErrors(parsed.error.issues, t));
      return;
    }
    setFieldErrors({});
    setBusy(true);
    try {
      const me = await api<MeResponse>('/auth/login', { method: 'POST', json: parsed.data });
      setUser(me);
      router.replace(postLoginPath(me, locale, returnTo));
    } catch (err) {
      setError(errorMessage(err, t));
      setBusy(false);
    }
  }

  return (
    <AuthCard title={t('auth.loginTitle')} subtitle={t('auth.loginSubtitle')}>
      <RoleChooser value={role} onChange={setRole} />
      <GoogleButton returnTo={returnTo} enabled={googleEnabled} as={role} />
      <form onSubmit={onSubmit} className="space-y-4" noValidate>
        {error && (
          <Alert tone="danger">
            {error}
            {error === t('auth.errors.INVALID_CREDENTIALS') && <p className="mt-1 text-xs">{t('auth.googleHint')}</p>}
          </Alert>
        )}
        <TextField label={t('auth.email')} type="email" autoComplete="email" required value={email} onChange={setEmail} error={fieldErrors.email} />
        <TextField
          label={t('auth.password')}
          type="password"
          autoComplete="current-password"
          required
          value={password}
          onChange={setPassword}
          error={fieldErrors.password}
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
        <Link
          href={`${withReturnTo(`/${locale}/register`, returnTo)}${role === 'SPEAKER' ? `${returnTo ? '&' : '?'}as=speaker` : ''}`}
          className="font-semibold text-primary hover:underline"
        >
          {t('nav.register')}
        </Link>
      </p>
    </AuthCard>
  );
}
