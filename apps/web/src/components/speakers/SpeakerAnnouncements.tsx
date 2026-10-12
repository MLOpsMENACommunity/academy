'use client';

import {
  courseStatusLabels,
  eventSpeakerRoleLabels,
  SPEAKER_ANNOUNCEMENT_BODY_MAX,
  SPEAKER_ANNOUNCEMENT_SUBJECT_MAX,
  speakerAnnouncementSchema,
  type SpeakerAnnouncementsDto,
  type SpeakerAnnouncementTargetKind,
  type SpeakerAnnouncementInput,
} from '@academy/shared';
import { useCallback, useEffect, useId, useRef, useState, type FormEvent } from 'react';
import { TextAreaField, TextField } from '@/components/forms/fields';
import { Alert } from '@/components/ui/Alert';
import { Badge } from '@/components/ui/Badge';
import { Button } from '@/components/ui/Button';
import { Card } from '@/components/ui/Card';
import { useI18n } from '@/i18n/client';
import type { Translate } from '@/i18n/translator';
import { api, ApiError } from '@/lib/api';
import { errorMessage } from '@/lib/errors';
import { formatDateTime, viewerTimezone } from '@/lib/format';
import { issuesToErrors } from '@/lib/zod-errors';

interface Target {
  kind: SpeakerAnnouncementTargetKind;
  id: string;
  title: string;
  audience: number;
  sentToday: number;
}

const EMPTY = { subjectEn: '', subjectAr: '', bodyEn: '', bodyAr: '' };
const newKey = () => crypto.randomUUID();

function announcementError(err: unknown, t: Translate): string {
  if (err instanceof ApiError && err.code) {
    const key = `speakerAnnouncements.errors.${err.code}`;
    const msg = t(key);
    if (msg !== key) return msg;
  }
  return errorMessage(err, t);
}

/**
 * Speaker portal → "My courses & sessions": announcements to the enrolled students of an
 * assigned course or the registrants of the speaker's own session. Nothing renders for a
 * speaker without a public profile yet (nothing can be assigned to them).
 */
export function SpeakerAnnouncements({ courseId }: { courseId?: string } = {}) {
  const { locale, t } = useI18n();
  const s = useCallback((k: string, v?: Record<string, string | number>) => t(`speakerAnnouncements.${k}`, v), [t]);
  const [data, setData] = useState<SpeakerAnnouncementsDto | null>(null);
  const [open, setOpen] = useState<string | null>(null);
  const [done, setDone] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      setData(await api<SpeakerAnnouncementsDto>('/speaker/announcements'));
    } catch (err) {
      setError(announcementError(err, t));
    }
  }, [t]);
  useEffect(() => {
    void load();
  }, [load]);

  // While emails are going out, refresh the delivery counts.
  const sending = data?.sent.some((a) => a.pending > 0) ?? false;
  useEffect(() => {
    if (!sending) return;
    const timer = setInterval(() => void load(), 5_000);
    return () => clearInterval(timer);
  }, [sending, load]);

  if (!data) return error ? <Alert tone="danger">{error}</Alert> : null;
  if (!data.hasProfile) return null;
  const pick = (en: string, ar: string) => (locale === 'ar' ? ar || en : en);
  const dayFull = data.limits.sentToday >= data.limits.perDay;
  // On a course's page (My courses → {course} → Announcements): that course only.
  const sent = courseId ? data.sent.filter((a) => a.kind === 'course' && a.targetId === courseId) : data.sent;
  const courses: (Target & { badge: string })[] = data.courses.filter((c) => !courseId || c.id === courseId).map((c) => ({
    kind: 'course',
    id: c.id,
    title: pick(c.titleEn, c.titleAr),
    audience: c.audience,
    sentToday: c.sentToday,
    badge: courseStatusLabels[c.status][locale],
  }));
  const sessions: (Target & { badge: string; when: string })[] = (courseId ? [] : data.sessions).map((e) => ({
    kind: 'session',
    id: e.id,
    title: pick(e.titleEn, e.titleAr),
    audience: e.audience,
    sentToday: e.sentToday,
    badge: eventSpeakerRoleLabels[e.role][locale],
    when: formatDateTime(e.startsAt, locale, viewerTimezone()),
  }));

  const row = (target: Target & { badge: string; when?: string }) => {
    const key = `${target.kind}:${target.id}`;
    const full = target.sentToday >= data.limits.perTargetPerDay;
    return (
      <li key={key}>
        <Card className="!p-4 sm:!p-5">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div className="min-w-0">
              <p className="font-medium break-words text-fg">{target.title}</p>
              <p className="mt-1 text-sm text-muted">
                {target.when && <>{target.when} · </>}
                {s(target.kind === 'course' ? 'audienceCourse' : 'audienceSession', { count: target.audience })}
              </p>
            </div>
            <Badge tone="info">{target.badge}</Badge>
          </div>
          {open === key ? (
            <Compose
              target={target}
              onCancel={() => setOpen(null)}
              onSent={(count) => {
                setOpen(null);
                setDone(s('sent', { count }));
                void load();
              }}
            />
          ) : (
            <div className="mt-3 flex flex-wrap items-center gap-x-3 gap-y-1">
              <Button
                variant="secondary"
                size="sm"
                disabled={target.audience === 0 || full || dayFull}
                onClick={() => {
                  setDone(null);
                  setOpen(key);
                }}
              >
                {s('write')}
              </Button>
              {target.audience === 0 ? (
                <span className="text-xs text-muted">{s('noAudience')}</span>
              ) : full ? (
                <span className="text-xs text-muted">{s('targetFull', { max: data.limits.perTargetPerDay })}</span>
              ) : null}
            </div>
          )}
        </Card>
      </li>
    );
  };

  return (
    <section aria-labelledby="speaker-ann-h" className="space-y-4">
      <div>
        <h2 id="speaker-ann-h" className={courseId ? 'text-xl' : 'text-2xl'}>
          {s(courseId ? 'courseTitle' : 'title')}
        </h2>
        <p className="mt-1 max-w-2xl text-sm text-muted">{s('intro')}</p>
      </div>
      {done && <Alert tone="success">{done}</Alert>}
      {error && <Alert tone="danger">{error}</Alert>}
      {courses.length + sessions.length === 0 ? (
        <p className="rounded-card border border-dashed border-line-strong/50 p-6 text-center text-muted">{s('none')}</p>
      ) : (
        <>
          <p className="text-xs text-muted">{s('limits', { perTarget: data.limits.perTargetPerDay, perDay: data.limits.perDay, used: data.limits.sentToday })}</p>
          {dayFull && <Alert tone="info">{s('dayFull', { max: data.limits.perDay })}</Alert>}
          {courses.length > 0 && (
            <>
              <h3 className="text-lg">{s('courses')}</h3>
              <ul className="space-y-3">{courses.map(row)}</ul>
            </>
          )}
          {sessions.length > 0 && (
            <>
              <h3 className="text-lg">{s('sessions')}</h3>
              <ul className="space-y-3">{sessions.map(row)}</ul>
            </>
          )}
        </>
      )}

      {sent.length > 0 && (
        <Card>
          <h3 className="text-lg">{s('history')}</h3>
          <ul className="mt-2 divide-y divide-line text-sm">
            {sent.map((a) => (
              <li key={a.id} className="py-3">
                <p className="font-semibold break-words text-fg">{pick(a.subjectEn, a.subjectAr)}</p>
                <p className="text-xs text-muted">
                  {formatDateTime(a.at, locale, viewerTimezone())} · {s(`kind.${a.kind}`)}: {pick(a.targetTitleEn, a.targetTitleAr)}
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

/** Write → review (who and how many) → send. One idempotency key per message. */
function Compose({ target, onCancel, onSent }: { target: Target; onCancel: () => void; onSent: (count: number) => void }) {
  const { t } = useI18n();
  const s = (k: string, v?: Record<string, string | number>) => t(`speakerAnnouncements.${k}`, v);
  const [msg, setMsg] = useState(EMPTY);
  const [key, setKey] = useState(newKey);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [error, setError] = useState<string | null>(null);
  const [review, setReview] = useState<SpeakerAnnouncementInput | null>(null);
  const [busy, setBusy] = useState(false);
  const confirmRef = useRef<HTMLDivElement>(null);
  const headingId = useId();

  useEffect(() => {
    if (review) confirmRef.current?.focus();
  }, [review]);

  // Editing the message makes it a new one (new key).
  const set = (k: keyof typeof EMPTY) => (v: string) => {
    setMsg((p) => ({ ...p, [k]: v }));
    setKey(newKey());
  };

  function onReview(e: FormEvent) {
    e.preventDefault();
    setError(null);
    const parsed = speakerAnnouncementSchema.safeParse({ ...msg, idempotencyKey: key });
    if (!parsed.success) {
      setErrors(issuesToErrors(parsed.error.issues, t));
      return;
    }
    setErrors({});
    setReview(parsed.data);
  }

  async function send() {
    if (!review) return;
    setBusy(true);
    setError(null);
    try {
      const path = target.kind === 'course' ? `/speaker/courses/${target.id}/announcements` : `/speaker/sessions/${target.id}/announcements`;
      const r = await api<{ recipients: number }>(path, { method: 'POST', json: review });
      onSent(r.recipients);
    } catch (err) {
      setError(announcementError(err, t));
      setBusy(false);
    }
  }

  return (
    <form onSubmit={onReview} noValidate aria-labelledby={headingId} className="mt-3 space-y-3 rounded-xl bg-muted-bg p-4">
      <h4 id={headingId} className="font-semibold break-words text-fg">
        {s('composeTitle', { title: target.title })}
      </h4>
      {error && <Alert tone="danger">{error}</Alert>}
      {review ? (
        <div ref={confirmRef} tabIndex={-1} className="space-y-3 outline-none">
          <Alert tone="warning" title={s('confirmTitle', { count: target.audience })}>
            {s('confirmBody')}
          </Alert>
          <div className="rounded-xl border border-line bg-card p-4">
            <div dir="ltr" lang="en">
              <p className="font-semibold break-words text-fg">{review.subjectEn}</p>
              <p className="mt-2 text-sm break-words whitespace-pre-line text-body">{review.bodyEn}</p>
            </div>
            {(review.subjectAr || review.bodyAr) && (
              <div dir="rtl" lang="ar" className="mt-3 border-t border-line pt-3">
                <p className="font-semibold break-words text-fg">{review.subjectAr || review.subjectEn}</p>
                <p className="mt-2 text-sm break-words whitespace-pre-line text-body">{review.bodyAr || review.bodyEn}</p>
              </div>
            )}
          </div>
          <div className="flex flex-wrap gap-2">
            <Button type="button" loading={busy} onClick={send}>
              {s('send')}
            </Button>
            <Button type="button" variant="ghost" disabled={busy} onClick={() => setReview(null)}>
              {s('edit')}
            </Button>
          </div>
        </div>
      ) : (
        <>
          <div className="grid gap-3 sm:grid-cols-2">
            <TextField label={s('subjectEn')} required dir="ltr" value={msg.subjectEn} onChange={set('subjectEn')} error={errors.subjectEn} maxLength={SPEAKER_ANNOUNCEMENT_SUBJECT_MAX} />
            <TextField label={s('subjectAr')} hint={s('arHint')} dir="rtl" value={msg.subjectAr} onChange={set('subjectAr')} error={errors.subjectAr} maxLength={SPEAKER_ANNOUNCEMENT_SUBJECT_MAX} />
            <TextAreaField
              label={s('bodyEn')}
              hint={s('bodyHint', { max: SPEAKER_ANNOUNCEMENT_BODY_MAX.toLocaleString() })}
              required
              dir="ltr"
              rows={6}
              value={msg.bodyEn}
              onChange={set('bodyEn')}
              error={errors.bodyEn}
              maxLength={SPEAKER_ANNOUNCEMENT_BODY_MAX}
            />
            <TextAreaField label={s('bodyAr')} hint={s('arHint')} dir="rtl" rows={6} value={msg.bodyAr} onChange={set('bodyAr')} error={errors.bodyAr} maxLength={SPEAKER_ANNOUNCEMENT_BODY_MAX} />
          </div>
          <div className="flex flex-wrap gap-2">
            <Button type="submit">{s('review')}</Button>
            <Button type="button" variant="ghost" onClick={onCancel}>
              {s('cancel')}
            </Button>
          </div>
        </>
      )}
    </form>
  );
}
