'use client';

import type { MeResponse } from '@academy/shared';
import { useRouter } from 'next/navigation';
import { useState, type FormEvent, type ReactNode } from 'react';
import { useAuth } from '@/components/auth/AuthProvider';
import { RadioGroup, TextField } from '@/components/forms/fields';
import { CalendarFeedPanel } from '@/components/profile/CalendarFeedPanel';
import { Alert } from '@/components/ui/Alert';
import { Button } from '@/components/ui/Button';
import { useI18n } from '@/i18n/client';
import { api } from '@/lib/api';
import { downloadViaApi } from '@/lib/download';
import { errorMessage } from '@/lib/errors';

function Block({ title, children, tone }: { title: string; children: ReactNode; tone?: 'danger' }) {
  return (
    <section className={`rounded-card border p-5 ${tone === 'danger' ? 'border-danger/30 bg-danger-soft/40' : 'border-line bg-card'}`}>
      <h3 className={`text-lg ${tone === 'danger' ? 'text-danger' : ''}`}>{title}</h3>
      <div className="mt-3">{children}</div>
    </section>
  );
}

export function AccountPanel({ user }: { user: MeResponse }) {
  const { locale, t } = useI18n();
  const { reload, setUser } = useAuth();
  const router = useRouter();
  const [msg, setMsg] = useState<Record<string, { tone: 'success' | 'danger'; text: string } | undefined>>({});
  const [busy, setBusy] = useState<string | null>(null);
  const [curPw, setCurPw] = useState('');
  const [newPw, setNewPw] = useState('');
  const [confirm, setConfirm] = useState('');
  const [delPw, setDelPw] = useState('');

  async function run(key: string, fn: () => Promise<string | void>) {
    setBusy(key);
    setMsg((m) => ({ ...m, [key]: undefined }));
    try {
      const text = await fn();
      if (text) setMsg((m) => ({ ...m, [key]: { tone: 'success', text } }));
    } catch (err) {
      setMsg((m) => ({ ...m, [key]: { tone: 'danger', text: errorMessage(err, t) } }));
    } finally {
      setBusy(null);
    }
  }
  const note = (key: string) => {
    const m = msg[key];
    if (!m) return null;
    const reauth = m.text === t('auth.errors.REAUTH_REQUIRED');
    return (
      <Alert tone={m.tone} className="mt-3">
        {m.text}
        {reauth && (
          <>
            {' '}
            <a
              className="font-semibold underline"
              href={`/api/auth/google?locale=${locale}&returnTo=${encodeURIComponent(`/${locale}/profile?tab=account`)}`}
            >
              {t('auth.google')}
            </a>
          </>
        )}
      </Alert>
    );
  };

  return (
    <div className="space-y-5">
      <Block title={t('account.language')}>
        <RadioGroup
          legend={t('account.language')}
          value={user.locale}
          required
          options={[
            { value: 'en', label: 'English' },
            { value: 'ar', label: 'العربية' },
          ]}
          onChange={(v) =>
            run('locale', async () => {
              await api('/me/account', { method: 'PATCH', json: { locale: v } });
              await reload();
              return t('common.saved');
            })
          }
        />
        {note('locale')}
      </Block>

      <Block title={user.hasPassword ? t('account.changePassword') : t('account.setPassword')}>
        {!user.hasPassword && <p className="mb-3 text-sm text-muted">{t('account.googleOnly')}</p>}
        <form
          className="grid gap-4 sm:grid-cols-2"
          onSubmit={(e: FormEvent) => {
            e.preventDefault();
            void run('password', async () => {
              await api('/me/password', {
                method: 'POST',
                json: { currentPassword: curPw || undefined, newPassword: newPw },
              });
              setUser(null);
              router.replace(`/${locale}/login?returnTo=${encodeURIComponent(`/${locale}/profile`)}`);
            });
          }}
        >
          {user.hasPassword && (
            <TextField label={t('auth.currentPassword')} type="password" autoComplete="current-password" required value={curPw} onChange={setCurPw} />
          )}
          <TextField
            label={t('auth.newPassword')}
            type="password"
            autoComplete="new-password"
            required
            minLength={10}
            hint={t('auth.passwordHint')}
            value={newPw}
            onChange={setNewPw}
          />
          <div className="sm:col-span-2">
            <Button type="submit" variant="secondary" loading={busy === 'password'}>
              {user.hasPassword ? t('account.changePassword') : t('account.setPassword')}
            </Button>
          </div>
        </form>
        {note('password')}
      </Block>

      <Block title={t('account.calendarTitle')}>
        <CalendarFeedPanel />
      </Block>

      <Block title={t('account.exportTitle')}>
        <p className="text-sm text-muted">{t('account.exportBody')}</p>
        <Button
          type="button"
          variant="secondary"
          className="mt-3"
          loading={busy === 'export'}
          onClick={() =>
            // Through api() (downloadViaApi) so an expired session refreshes first instead of saving a 401 as the "export".
            run('export', () => downloadViaApi('/me/export', 'mlops-mena-academy-data.json'))
          }
        >
          ⬇ {t('account.exportCta')}
        </Button>
        {note('export')}
      </Block>

      <Block title={t('account.deleteTitle')} tone="danger">
        <p className="text-sm text-body">{t('account.deleteBody')}</p>
        <form
          className="mt-4 grid gap-4 sm:grid-cols-2"
          onSubmit={(e: FormEvent) => {
            e.preventDefault();
            void run('delete', async () => {
              await api('/me/delete', { method: 'POST', json: { confirm, password: delPw || undefined } });
              setUser(null);
              router.replace(`/${locale}?deleted=1`);
            });
          }}
        >
          <TextField label={t('account.deleteConfirmLabel')} required value={confirm} onChange={setConfirm} autoComplete="off" dir="ltr" />
          {user.hasPassword && (
            <TextField label={t('auth.currentPassword')} type="password" autoComplete="current-password" required value={delPw} onChange={setDelPw} />
          )}
          <div className="sm:col-span-2">
            <Button type="submit" variant="danger" loading={busy === 'delete'} disabled={confirm !== 'DELETE'}>
              {t('account.deleteCta')}
            </Button>
          </div>
        </form>
        {note('delete')}
      </Block>
    </div>
  );
}
