'use client';

import { addStudentSchema } from '@academy/shared';
import Link from 'next/link';
import { useState, type FormEvent } from 'react';
import { RadioGroup, TextField } from '@/components/forms/fields';
import { Alert } from '@/components/ui/Alert';
import { Button } from '@/components/ui/Button';
import { useI18n } from '@/i18n/client';
import { api, ApiError } from '@/lib/api';
import { errorMessage } from '@/lib/errors';
import { issuesToErrors } from '@/lib/zod-errors';

/**
 * "Add student": creates a student account for an email address. Nobody sets a password for
 * them: they get an email to choose their own, then complete their profile.
 */
export function AddStudent() {
  const { locale, t } = useI18n();
  const [open, setOpen] = useState(false);
  const [email, setEmail] = useState('');
  const [name, setName] = useState('');
  const [lang, setLang] = useState<string>(locale);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [error, setError] = useState<{ message: string; userId?: string } | null>(null);
  const [added, setAdded] = useState<{ id: string; email: string } | null>(null);
  const [busy, setBusy] = useState(false);

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    const parsed = addStudentSchema.safeParse({ email, fullNameEn: name, locale: lang });
    if (!parsed.success) {
      setErrors(issuesToErrors(parsed.error.issues, t));
      return;
    }
    setErrors({});
    setBusy(true);
    try {
      setAdded(await api<{ id: string; email: string }>('/admin/students', { method: 'POST', json: parsed.data }));
      setEmail('');
      setName('');
      setOpen(false);
    } catch (err) {
      const id = err instanceof ApiError && err.code === 'EMAIL_TAKEN' ? err.body.userId : undefined;
      const existing = typeof id === 'string' ? id : undefined;
      setError({ message: errorMessage(err, t), userId: existing });
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="w-full">
      {added && (
        <Alert tone="success" className="mb-4">
          {t('admin.addStudent.done', { email: added.email })}{' '}
          <Link href={`/${locale}/admin/students/${added.id}`} className="font-medium underline">
            {t('admin.addStudent.open')}
          </Link>
        </Alert>
      )}
      {!open ? (
        <Button size="sm" onClick={() => setOpen(true)}>
          + {t('admin.addStudent.button')}
        </Button>
      ) : (
        <form onSubmit={onSubmit} noValidate className="space-y-4 rounded-card border border-line bg-card p-4">
          <h2 className="text-lg">{t('admin.addStudent.title')}</h2>
          <p className="text-sm text-muted">{t('admin.addStudent.intro')}</p>
          {error && (
            <Alert tone="danger">
              {error.message}{' '}
              {error.userId && (
                <Link href={`/${locale}/admin/students/${error.userId}`} className="font-medium underline">
                  {t('admin.addStudent.open')}
                </Link>
              )}
            </Alert>
          )}
          <div className="grid gap-4 sm:grid-cols-2">
            <TextField label={t('admin.addStudent.email')} required type="email" dir="ltr" autoComplete="off" value={email} onChange={setEmail} error={errors.email} />
            <TextField label={t('admin.addStudent.name')} value={name} onChange={setName} error={errors.fullNameEn} />
          </div>
          <RadioGroup
            legend={t('admin.addStudent.language')}
            value={lang}
            onChange={setLang}
            options={[
              { value: 'en', label: 'English' },
              { value: 'ar', label: 'العربية' },
            ]}
          />
          <div className="flex flex-wrap gap-2">
            <Button type="submit" loading={busy}>
              {t('admin.addStudent.submit')}
            </Button>
            <Button type="button" variant="ghost" onClick={() => setOpen(false)}>
              {t('admin.common.cancel')}
            </Button>
          </div>
        </form>
      )}
    </div>
  );
}
