'use client';

import { homePath, registerSchema, type MeResponse, type SignupRole } from '@academy/shared';
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
import { errorMessage } from '@/lib/errors';
import { issuesToErrors } from '@/lib/zod-errors';
import { useReturnTo, withReturnTo } from '@/lib/use-return-to';
import { useSearchParam } from '@/lib/use-search-param';
import { postLoginPath } from '../login/LoginForm';

export function RegisterForm({ googleEnabled }: { googleEnabled?: boolean }) {
  const { locale, t } = useI18n();
  const { user, setUser } = useAuth();
  const router = useRouter();
  const returnTo = useReturnTo();
  const [email, setEmail] = useState('');
  // Prefilled from an "Enrol by email" invitation link (?email=…); never overwrites typing.
  const emailParam = useSearchParam('email');
  useEffect(() => {
    if (emailParam) setEmail((current) => current || emailParam);
  }, [emailParam]);
  const [password, setPassword] = useState('');
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const asParam = useSearchParam('as');
  const [role, setRole] = useState<SignupRole>('STUDENT');
  useEffect(() => setRole(initialSignupRole(asParam)), [asParam]);
  const speaker = role === 'SPEAKER';

  useEffect(() => {
    if (user) router.replace(postLoginPath(user, locale, returnTo, true));
  }, [user, router, locale, returnTo]);

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    const parsed = registerSchema.safeParse({ email, password, locale, returnTo, role });
    if (!parsed.success) {
      setFieldErrors(issuesToErrors(parsed.error.issues, t));
      return;
    }
    setFieldErrors({});
    setBusy(true);
    try {
      const me = await api<MeResponse>('/auth/register', { method: 'POST', json: parsed.data });
      setUser(me);
      // Speakers skip student onboarding and land on their portal.
      router.replace(me.role === 'SPEAKER' ? homePath('SPEAKER', locale) : withReturnTo(`/${locale}/onboarding`, returnTo));
    } catch (err) {
      setError(errorMessage(err, t));
      setBusy(false);
    }
  }

  const terms = (
    <Link href={`/${locale}/terms`} className="text-primary underline" target="_blank">
      {t('footer.terms')}
    </Link>
  );
  const privacy = (
    <Link href={`/${locale}/privacy`} className="text-primary underline" target="_blank">
      {t('footer.privacy')}
    </Link>
  );
  const [before, middle, after] = t('auth.termsNotice').split(/\{terms\}|\{privacy\}/);

  return (
    <AuthCard title={t('auth.registerTitle')} subtitle={speaker ? t('auth.speakerRegisterSubtitle') : t('auth.registerSubtitle')}>
      <RoleChooser value={role} onChange={setRole} />
      <GoogleButton
        returnTo={speaker ? homePath('SPEAKER', locale) : withReturnTo(`/${locale}/onboarding`, returnTo)}
        enabled={googleEnabled}
        as={role}
      />
      <form onSubmit={onSubmit} className="space-y-4" noValidate>
        {error && <Alert tone="danger">{error}</Alert>}
        <TextField
          label={t('auth.email')}
          type="email"
          autoComplete="email"
          required
          value={email}
          onChange={setEmail}
          error={fieldErrors.email}
        />
        <TextField
          label={t('auth.password')}
          type="password"
          autoComplete="new-password"
          required
          value={password}
          onChange={setPassword}
          hint={t('auth.passwordHint')}
          error={fieldErrors.password}
          minLength={10}
        />
        <Button type="submit" size="lg" className="w-full" loading={busy}>
          {t('auth.registerCta')}
        </Button>
        <p className="text-xs text-muted">
          {before}
          {terms}
          {middle}
          {privacy}
          {after}
        </p>
      </form>
      <p className="mt-6 text-center text-sm text-muted">
        {t('auth.haveAccount')}{' '}
        <Link href={withReturnTo(`/${locale}/login`, returnTo)} className="font-semibold text-primary hover:underline">
          {t('nav.login')}
        </Link>
      </p>
    </AuthCard>
  );
}
