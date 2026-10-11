'use client';

import { courseStatusLabels, type SpeakerAssignmentsDto } from '@academy/shared';
import Link from 'next/link';
import { useCallback, useEffect, useState } from 'react';
import { SelectField } from '@/components/forms/fields';
import { Alert } from '@/components/ui/Alert';
import { Badge } from '@/components/ui/Badge';
import { Button } from '@/components/ui/Button';
import { Card } from '@/components/ui/Card';
import { useI18n } from '@/i18n/client';
import { api } from '@/lib/api';
import { errorMessage } from '@/lib/errors';

/**
 * Admin → Speakers → {speaker}: the courses this speaker is assigned to. Assigned = one of the
 * course's instructors, so they can message its enrolled students from the speaker portal
 * (and they're listed on the public course page).
 */
export function SpeakerAssignedCourses({ instructorId }: { instructorId: string }) {
  const { locale, t } = useI18n();
  const s = (k: string, v?: Record<string, string | number>) => t(`speakerAssignments.${k}`, v);
  const [data, setData] = useState<SpeakerAssignmentsDto | null>(null);
  const [pick, setPick] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const title = (c: { titleEn: string; titleAr: string }) => (locale === 'ar' ? c.titleAr || c.titleEn : c.titleEn);

  const load = useCallback(() => {
    api<SpeakerAssignmentsDto>(`/admin/instructors/${instructorId}/courses`)
      .then(setData)
      .catch((err) => setError(errorMessage(err, t)));
  }, [instructorId, t]);
  useEffect(load, [load]);

  async function change(courseId: string, method: 'PUT' | 'DELETE') {
    setBusy(courseId);
    setError(null);
    try {
      setData(await api<SpeakerAssignmentsDto>(`/admin/instructors/${instructorId}/courses/${courseId}`, { method }));
      if (method === 'PUT') setPick(null);
    } catch (err) {
      setError(errorMessage(err, t));
    } finally {
      setBusy(null);
    }
  }

  return (
    <Card className="mt-5">
      <h2 className="text-xl">{s('title')}</h2>
      <p className="mt-1 max-w-2xl text-sm text-muted">{s('help')}</p>
      {error && (
        <Alert tone="danger" className="mt-3">
          {error}
        </Alert>
      )}
      {!data ? (
        <p className="mt-3 text-sm text-muted">{t('admin.common.loading')}</p>
      ) : (
        <>
          {!data.account ? (
            <Alert tone="warning" className="mt-3">
              {s('noAccount')}
            </Alert>
          ) : (
            <>
              <p className="mt-3 text-sm break-all text-body" dir="auto">
                {s('account', { email: data.account.email })}
              </p>
              {!data.account.active && (
                <Alert tone="warning" className="mt-2">
                  {s('inactive')}
                </Alert>
              )}
            </>
          )}

          {data.assigned.length === 0 ? (
            <p className="mt-4 text-sm text-muted">{s('none')}</p>
          ) : (
            <ul className="mt-4 divide-y divide-line rounded-xl border border-line">
              {data.assigned.map((c) => (
                <li key={c.id} className="flex flex-wrap items-center justify-between gap-3 px-4 py-3">
                  <div className="flex min-w-0 flex-wrap items-center gap-2">
                    <Link href={`/${locale}/admin/courses/${c.id}`} className="font-medium break-words text-fg hover:underline">
                      {title(c)}
                    </Link>
                    <Badge tone={c.status === 'ARCHIVED' ? 'neutral' : c.status === 'OPEN' ? 'success' : 'info'}>{courseStatusLabels[c.status][locale]}</Badge>
                  </div>
                  <Button
                    variant="ghost"
                    size="sm"
                    loading={busy === c.id}
                    disabled={busy !== null}
                    onClick={() => window.confirm(s('unassignConfirm', { title: title(c) })) && void change(c.id, 'DELETE')}
                  >
                    {s('unassign')}
                  </Button>
                </li>
              ))}
            </ul>
          )}

          {data.available.length === 0 ? (
            <p className="mt-4 text-sm text-muted">{s('noneAvailable')}</p>
          ) : (
            <div className="mt-4 flex flex-wrap items-end gap-3">
              <div className="min-w-0 flex-1 sm:max-w-md">
                <SelectField
                  label={s('course')}
                  required
                  value={pick}
                  onChange={setPick}
                  options={data.available.map((c) => ({ value: c.id, label: `${title(c)} · ${courseStatusLabels[c.status][locale]}` }))}
                />
              </div>
              <Button type="button" variant="secondary" disabled={!pick || busy !== null} loading={busy !== null && busy === pick} onClick={() => pick && void change(pick, 'PUT')}>
                {s('assign')}
              </Button>
            </div>
          )}
        </>
      )}
    </Card>
  );
}
