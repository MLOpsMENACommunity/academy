'use client';

import type { TeachAnnouncementsDto } from '@academy/shared';
import { useCallback, useEffect, useState } from 'react';
import { Compose, announcementError } from '@/components/speakers/SpeakerAnnouncements';
import { Alert } from '@/components/ui/Alert';
import { Button } from '@/components/ui/Button';
import { Card } from '@/components/ui/Card';
import { useI18n } from '@/i18n/client';
import { api } from '@/lib/api';
import { formatDateTime, viewerTimezone } from '@/lib/format';

/** Teaching → {course} → Announcements (ANNOUNCE): write to the enrolled students, sent at once; what the staff sent. */
export function TeachAnnouncements({ courseId, title }: { courseId: string; title: string }) {
  const { locale, t } = useI18n();
  const s = useCallback((k: string, v?: Record<string, string | number>) => t(`speakerAnnouncements.${k}`, v), [t]);
  const [data, setData] = useState<TeachAnnouncementsDto | null>(null);
  const [open, setOpen] = useState(false);
  const [done, setDone] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      setData(await api<TeachAnnouncementsDto>(`/teach/courses/${courseId}/announcements`));
    } catch (err) {
      setError(announcementError(err, t));
    }
  }, [courseId, t]);
  useEffect(() => {
    void load();
  }, [load]);

  const sending = data?.sent.some((a) => a.pending > 0) ?? false;
  useEffect(() => {
    if (!sending) return;
    const timer = setInterval(() => void load(), 5_000);
    return () => clearInterval(timer);
  }, [sending, load]);

  if (!data) return error ? <Alert tone="danger">{error}</Alert> : <p className="text-muted">{t('admin.common.loading')}</p>;
  const pick = (en: string, ar: string) => (locale === 'ar' ? ar || en : en);
  const dayFull = data.limits.sentTodayByMe >= data.limits.perDay;

  return (
    <section aria-labelledby="teach-ann-h" className="space-y-4">
      <div>
        <h2 id="teach-ann-h" className="text-xl">
          {s('courseTitle')}
        </h2>
        <p className="mt-1 max-w-2xl text-sm text-muted">{s('intro')}</p>
      </div>
      {done && <Alert tone="success">{done}</Alert>}
      {error && <Alert tone="danger">{error}</Alert>}
      <p className="text-xs text-muted">{s('limits', { perTarget: data.limits.perTargetPerDay, perDay: data.limits.perDay, used: data.limits.sentTodayByMe })}</p>
      {dayFull && <Alert tone="info">{s('dayFull', { max: data.limits.perDay })}</Alert>}
      <Card className="!p-4 sm:!p-5">
        <p className="font-medium break-words text-fg">{title}</p>
        <p className="mt-1 text-sm text-muted">{s('audienceCourse', { count: data.audience })}</p>
        {open ? (
          <Compose
            target={{ kind: 'course', id: courseId, title, audience: data.audience, sentToday: data.sentToday }}
            onCancel={() => setOpen(false)}
            onSent={(count) => {
              setOpen(false);
              setDone(s('sent', { count }));
              void load();
            }}
          />
        ) : (
          <div className="mt-3 flex flex-wrap items-center gap-x-3 gap-y-1">
            <Button
              variant="secondary"
              size="sm"
              disabled={data.audience === 0 || dayFull}
              onClick={() => {
                setDone(null);
                setOpen(true);
              }}
            >
              {s('write')}
            </Button>
            {data.audience === 0 && <span className="text-xs text-muted">{s('noAudience')}</span>}
          </div>
        )}
      </Card>

      {data.sent.length > 0 && (
        <Card>
          <h3 className="text-lg">{t('teach.announcements.history')}</h3>
          <ul className="mt-2 divide-y divide-line text-sm">
            {data.sent.map((a) => (
              <li key={a.id} className="py-3">
                <p className="font-semibold break-words text-fg">{pick(a.subjectEn, a.subjectAr)}</p>
                <p className="text-xs text-muted">
                  {formatDateTime(a.at, locale, viewerTimezone())}
                  {a.from && <> · {t('teach.announcements.from', { name: a.from })}</>}
                </p>
                <p className="text-xs">
                  {s('delivered', { sent: a.sent, count: a.recipients })}
                  {a.pending ? <span> · {s('sending', { count: a.pending })}</span> : null}
                  {a.failed ? <span className="text-danger"> · {s('failed', { count: a.failed })}</span> : null}
                </p>
              </li>
            ))}
          </ul>
        </Card>
      )}
    </section>
  );
}
