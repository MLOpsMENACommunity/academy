'use client';

import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { TextField } from '@/components/forms/fields';
import { Button } from '@/components/ui/Button';
import { useI18n } from '@/i18n/client';
import { api, ApiError } from '@/lib/api';
import { errorMessage } from '@/lib/errors';

/** Copies a course as a new draft (e.g. the next cohort): content, questions, sessions, instructors. */
export function DuplicateCourse({ courseId, slug, titleEn }: { courseId: string; slug: string; titleEn: string }) {
  const { locale, t } = useI18n();
  const router = useRouter();
  const [newSlug, setNewSlug] = useState(`${slug}-2`);
  const [title, setTitle] = useState(titleEn);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const c = (k: string) => t(`admin.courses.duplicate.${k}`);

  async function run() {
    setError(null);
    setBusy(true);
    try {
      const r = await api<{ id: string }>(`/admin/courses/${courseId}/duplicate`, { method: 'POST', json: { slug: newSlug, titleEn: title } });
      router.push(`/${locale}/admin/courses/${r.id}`);
    } catch (err) {
      setError(err instanceof ApiError && err.code === 'SLUG_TAKEN' ? t('admin.courses.duplicate.slugTaken') : errorMessage(err, t));
      setBusy(false);
    }
  }

  return (
    <details className="relative">
      <summary className="cursor-pointer list-none rounded-lg border border-line-strong px-3 py-1.5 text-sm font-semibold">{c('button')}</summary>
      <div className="absolute end-0 z-30 mt-2 w-80 space-y-3 rounded-card border border-line bg-card p-4 shadow-lg">
        <p className="text-sm text-muted">{c('help')}</p>
        <TextField label={t('admin.courses.fields.slug')} required dir="ltr" value={newSlug} onChange={setNewSlug} error={error ?? undefined} />
        <TextField label={t('admin.courses.fields.titleEn')} required value={title} onChange={setTitle} />
        <Button type="button" size="sm" loading={busy} onClick={run}>
          {c('create')}
        </Button>
      </div>
    </details>
  );
}
