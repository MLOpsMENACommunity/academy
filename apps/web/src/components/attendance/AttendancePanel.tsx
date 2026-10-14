'use client';

import {
  ATTENDANCE_STATUSES,
  attendanceSettingsSchema,
  type AttendanceCourseDto,
  type AttendancePreviewDto,
  type AttendanceRecord,
  type AttendanceRowDto,
  type AttendanceSessionDto,
  type AttendanceSettings,
  type AttendanceSheetError,
  type AttendanceStatus,
} from '@academy/shared';
import { useCallback, useEffect, useId, useRef, useState, type ChangeEvent, type FormEvent } from 'react';
import { TextField } from '@/components/forms/fields';
import { Alert } from '@/components/ui/Alert';
import { Badge, type Tone } from '@/components/ui/Badge';
import { Button } from '@/components/ui/Button';
import { Card } from '@/components/ui/Card';
import { inputClass } from '@/components/ui/input';
import { LocalTime } from '@/components/course/LocalTime';
import { useI18n } from '@/i18n/client';
import { api } from '@/lib/api';
import { AttendanceFileError, readAttendanceFile } from '@/lib/attendance-file';
import { downloadViaApi } from '@/lib/download';
import { errorMessage } from '@/lib/errors';
import { formatDate } from '@/lib/format';
import { issuesToErrors } from '@/lib/zod-errors';

export const STATUS_TONE: Record<AttendanceStatus, Tone> = { PRESENT: 'success', PARTIAL: 'warning', ABSENT: 'neutral' };

/**
 * Attendance from Google Meet for one course: the course's rule and points, each session's
 * counts, an upload with a preview (match unmatched rows by hand, mark students by hand), and
 * the CSV export. `base` is the course's API path: /admin/courses/{id} or /speaker/courses/{id}.
 * Only admins change the course's rule (`canEditSettings`); anyone here can override the
 * threshold for one upload.
 */
export function AttendancePanel({ base, canEditSettings, sessionId, onSession }: { base: string; canEditSettings: boolean; sessionId: string | null; onSession: (id: string | null) => void }) {
  const { locale, t } = useI18n();
  const a = useCallback((k: string, v?: Record<string, string | number>) => t(`attendance.${k}`, v), [t]);
  const [course, setCourse] = useState<AttendanceCourseDto | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(() => {
    api<AttendanceCourseDto>(`${base}/attendance`)
      .then(setCourse)
      .catch((e: unknown) => setError(errorMessage(e, t)));
  }, [base, t]);
  useEffect(load, [load]);

  if (!course) return error ? <Alert tone="danger">{error}</Alert> : <p className="text-muted">{t('admin.common.loading')}</p>;
  const session = course.sessions.find((s) => s.id === sessionId) ?? null;

  if (session) {
    return (
      <div className="flex flex-col gap-4">
        <button type="button" onClick={() => onSession(null)} className="inline-flex min-h-11 items-center gap-1.5 self-start text-sm text-muted hover:underline">
          <span aria-hidden className="inline-block rtl:rotate-180">
            ←
          </span>
          {a('allSessions')}
        </button>
        <SessionAttendance base={base} sessionId={session.id} students={course.students} onSaved={load} />
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-5">
      <p className="max-w-3xl text-sm text-muted">{a('intro')}</p>
      {error && <Alert tone="danger">{error}</Alert>}
      <RuleCard base={base} settings={course.settings} editable={canEditSettings} onSaved={(settings) => setCourse({ ...course, settings })} />
      <div className="flex flex-wrap items-center gap-3">
        <h2 className="text-lg">{a('sessions')}</h2>
        <Button
          variant="secondary"
          size="sm"
          className="ms-auto"
          loading={busy}
          onClick={async () => {
            setBusy(true);
            try {
              await downloadViaApi(`${base}/attendance.csv`, 'attendance.csv');
            } catch (e) {
              setError(errorMessage(e, t));
            } finally {
              setBusy(false);
            }
          }}
        >
          ⬇ {a('export')}
        </Button>
      </div>
      {course.sessions.length === 0 ? (
        <p className="text-muted">{a('noSessions')}</p>
      ) : (
        <ul className="flex flex-col gap-2">
          {course.sessions.map((s) => (
            <li key={s.id}>
              <button
                type="button"
                onClick={() => onSession(s.id)}
                className="flex min-h-11 w-full flex-wrap items-center gap-x-3 gap-y-1 rounded-xl border border-line bg-card px-4 py-3 text-start hover:bg-hover-bg"
              >
                <span className="min-w-0 flex-1">
                  <span className="block font-medium break-words text-fg">
                    {s.order}. {locale === 'ar' ? s.titleAr : s.titleEn}
                  </span>
                  <span className="block text-xs text-muted">
                    <LocalTime iso={s.startsAt} style="weekday-datetime" /> · {t('course.minutes', { count: s.durationMin })}
                  </span>
                </span>
                {s.recorded ? (
                  <span className="flex flex-wrap gap-1.5">
                    <Badge tone="success">{a('countPresent', { count: s.present })}</Badge>
                    <Badge tone="warning">{a('countPartial', { count: s.partial })}</Badge>
                    <Badge>{a('countAbsent', { count: s.absent })}</Badge>
                  </span>
                ) : (
                  <Badge tone="info">{a('notRecorded')}</Badge>
                )}
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function RuleCard({ base, settings, editable, onSaved }: { base: string; settings: AttendanceSettings; editable: boolean; onSaved: (s: AttendanceSettings) => void }) {
  const { t } = useI18n();
  const a = (k: string, v?: Record<string, string | number>) => t(`attendance.${k}`, v);
  const [form, setForm] = useState<Record<keyof AttendanceSettings, string>>(() => ({
    presentPercent: String(settings.presentPercent),
    presentPoints: String(settings.presentPoints),
    partialPoints: String(settings.partialPoints),
    absentPoints: String(settings.absentPoints),
  }));
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [msg, setMsg] = useState<{ tone: 'success' | 'danger'; text: string } | null>(null);
  const [busy, setBusy] = useState(false);

  async function save(e: FormEvent) {
    e.preventDefault();
    setMsg(null);
    const parsed = attendanceSettingsSchema.safeParse(form);
    if (!parsed.success) {
      setErrors(issuesToErrors(parsed.error.issues, t));
      return;
    }
    setErrors({});
    setBusy(true);
    try {
      onSaved(await api<AttendanceSettings>(`${base}/attendance/settings`, { method: 'PUT', json: parsed.data }));
      setMsg({ tone: 'success', text: a('ruleSaved') });
    } catch (err) {
      setMsg({ tone: 'danger', text: errorMessage(err, t) });
    } finally {
      setBusy(false);
    }
  }

  const summary = a('ruleSummary', { percent: settings.presentPercent, present: settings.presentPoints, partial: settings.partialPoints, absent: settings.absentPoints });
  return (
    <Card>
      <h2 className="text-lg">{a('rule')}</h2>
      <p className="mt-1 text-sm text-muted">{summary}</p>
      {editable && (
        <form onSubmit={save} noValidate className="mt-3 flex flex-col gap-3">
          <div className="grid gap-3 sm:grid-cols-4">
            {(['presentPercent', 'presentPoints', 'partialPoints', 'absentPoints'] as const).map((k) => (
              <TextField key={k} label={a(`settings.${k}`)} type="number" inputMode="numeric" dir="ltr" required value={form[k]} error={errors[k]} onChange={(v) => setForm({ ...form, [k]: v })} />
            ))}
          </div>
          <p className="text-xs text-muted">{a('ruleHint')}</p>
          {msg && (
            <p role="status" className={`text-sm ${msg.tone === 'success' ? 'text-success' : 'text-danger'}`}>
              {msg.text}
            </p>
          )}
          <Button type="submit" size="sm" variant="secondary" className="self-start" loading={busy}>
            {a('saveRule')}
          </Button>
        </form>
      )}
    </Card>
  );
}

type Preview = AttendancePreviewDto & { file: string; records: AttendanceRecord[]; skipped: AttendanceSheetError[] };

/** One session: what is recorded, and the upload with its preview. */
function SessionAttendance({ base, sessionId, students, onSaved }: { base: string; sessionId: string; students: AttendanceCourseDto['students']; onSaved: () => void }) {
  const { locale, t } = useI18n();
  const a = (k: string, v?: Record<string, string | number>) => t(`attendance.${k}`, v);
  const url = `${base}/sessions/${sessionId}/attendance`;
  const [stored, setStored] = useState<AttendanceSessionDto | null>(null);
  const [preview, setPreview] = useState<Preview | null>(null);
  const [assign, setAssign] = useState<Record<number, string>>({});
  const [ignore, setIgnore] = useState<Set<number>>(new Set());
  const [statuses, setStatuses] = useState<Record<string, AttendanceStatus>>({});
  const [percent, setPercent] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<string | null>(null);
  const [busy, setBusy] = useState<'read' | 'preview' | 'save' | null>(null);
  const previewRef = useRef<HTMLDivElement>(null);
  const percentId = useId();

  const load = useCallback(() => {
    api<AttendanceSessionDto>(url)
      .then(setStored)
      .catch((e: unknown) => setError(errorMessage(e, t)));
  }, [url, t]);
  useEffect(load, [load]);

  const body = (p: Pick<Preview, 'records'>, dryRun: boolean, choices = { assign, ignore, statuses, percent }) => ({
    records: p.records.map((r) => ({ name: r.name, email: r.email, minutes: r.minutes })),
    assign: Object.entries(choices.assign)
      .filter(([, userId]) => userId)
      .map(([index, userId]) => ({ index: Number(index), userId })),
    ignore: [...choices.ignore],
    statuses: Object.entries(choices.statuses).map(([userId, status]) => ({ userId, status })),
    presentPercent: choices.percent ? Number(choices.percent) : null,
    dryRun,
  });

  async function refresh(p: Pick<Preview, 'file' | 'records' | 'skipped'>, choices = { assign, ignore, statuses, percent }) {
    setBusy('preview');
    setError(null);
    try {
      const r = await api<AttendancePreviewDto>(url, { method: 'POST', json: body(p, true, choices) });
      setPreview({ ...r, file: p.file, records: p.records, skipped: p.skipped });
    } catch (err) {
      setError(errorMessage(err, t));
    } finally {
      setBusy(null);
    }
  }

  async function onFile(e: ChangeEvent<HTMLInputElement>) {
    const f = e.target.files?.[0];
    e.target.value = '';
    setPreview(null);
    setError(null);
    setDone(null);
    if (!f) return;
    setBusy('read');
    try {
      const sheet = await readAttendanceFile(f);
      const fatal = sheet.errors.find((x) => x.row === 0);
      if (fatal) {
        setError(a(`fileErrors.${fatal.code}`));
        setBusy(null);
        return;
      }
      const fresh = { assign: {}, ignore: new Set<number>(), statuses: {}, percent };
      setAssign({});
      setIgnore(new Set());
      setStatuses({});
      await refresh({ file: f.name, records: sheet.records, skipped: sheet.errors }, fresh);
      requestAnimationFrame(() => previewRef.current?.focus());
    } catch (err) {
      setError(err instanceof AttendanceFileError && err.code === 'TOO_BIG' ? a('tooBig') : a('badFile'));
      setBusy(null);
    }
  }

  async function save() {
    if (!preview) return;
    setBusy('save');
    setError(null);
    try {
      const r = await api<AttendancePreviewDto>(url, { method: 'POST', json: body(preview, false) });
      setPreview(null);
      setDone(a('saved', { present: r.counts.present, partial: r.counts.partial, absent: r.counts.absent }));
      load();
      onSaved();
    } catch (err) {
      setError(errorMessage(err, t));
    } finally {
      setBusy(null);
    }
  }

  async function mark(userId: string, status: AttendanceStatus) {
    setError(null);
    setDone(null);
    try {
      await api<AttendanceRowDto>(`${url}/${userId}`, { method: 'PUT', json: { status } });
      load();
      onSaved();
    } catch (err) {
      setError(errorMessage(err, t));
    }
  }

  if (!stored) return error ? <Alert tone="danger">{error}</Alert> : <p className="text-muted">{t('admin.common.loading')}</p>;
  const s = stored.session;
  const studentLabel = (x: { name: string | null; email: string }) => (x.name ? `${x.name} (${x.email})` : x.email);

  return (
    <div className="flex flex-col gap-5">
      <div>
        <h2 className="text-xl break-words">
          {s.order}. {locale === 'ar' ? s.titleAr : s.titleEn}
        </h2>
        <p className="text-sm text-muted">
          <LocalTime iso={s.startsAt} style="weekday-datetime" /> · {t('course.minutes', { count: s.durationMin })}
        </p>
      </div>

      <Card>
        <h3 className="text-lg">{a('upload')}</h3>
        <p className="mt-1 max-w-3xl text-sm text-muted">{a('uploadIntro')}</p>
        <p className="mt-1 max-w-3xl text-xs text-muted">{a('formats')}</p>
        <div className="mt-3 flex flex-wrap items-end gap-3">
          <label className="inline-flex min-h-11 cursor-pointer items-center rounded-lg border border-line-button bg-card px-4 text-sm font-medium hover:bg-hover-bg focus-within:outline-2 focus-within:outline-primary">
            {busy === 'read' ? a('reading') : a('choose')}
            <input type="file" accept=".xlsx,.csv,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet,text/csv" className="sr-only" disabled={busy !== null} onChange={(e) => void onFile(e)} />
          </label>
          <span className="flex flex-col gap-1 text-sm">
            <label htmlFor={percentId} className="text-muted">
              {a('override', { percent: stored.settings.presentPercent })}
            </label>
            <input
              id={percentId}
              type="number"
              inputMode="numeric"
              min={1}
              max={100}
              dir="ltr"
              className={`${inputClass} w-28`}
              value={percent}
              placeholder={String(stored.settings.presentPercent)}
              onChange={(e) => setPercent(e.target.value)}
              onBlur={() => preview && void refresh(preview)}
            />
          </span>
        </div>
        {error && (
          <Alert tone="danger" className="mt-3">
            {error}
          </Alert>
        )}
        {done && (
          <p role="status" className="mt-3 text-sm font-medium text-success">
            {done}
          </p>
        )}

        {preview && (
          <div ref={previewRef} tabIndex={-1} className="mt-4 flex flex-col gap-4 focus:outline-none" aria-live="polite">
            <p className="text-sm font-semibold text-fg">
              <span className="ltr-embed">{a('previewTitle', { file: preview.file })}</span>
            </p>
            <p className="text-sm text-muted">
              {a('previewSummary', { present: preview.counts.present, partial: preview.counts.partial, absent: preview.counts.absent, percent: preview.presentPercent })}{' '}
              {preview.pointsChange !== 0 && a('pointsChange', { points: preview.pointsChange > 0 ? `+${preview.pointsChange}` : String(preview.pointsChange) })}
            </p>
            {preview.skipped.length > 0 && <Alert tone="warning">{a('skipped', { count: preview.skipped.length, rows: preview.skipped.map((x) => x.row).join(', ') })}</Alert>}

            {preview.unmatched.length > 0 && (
              <section aria-labelledby="att-unmatched" className="flex flex-col gap-2 rounded-xl border border-warning/40 bg-warning-soft/40 p-3">
                <h4 id="att-unmatched" className="text-sm font-semibold text-fg">
                  {a('unmatched', { count: preview.unmatched.length })}
                </h4>
                <p className="text-xs text-muted">{a('unmatchedHint')}</p>
                <ul className="flex flex-col gap-2">
                  {preview.unmatched.map((u) => (
                    <li key={u.index} className="flex flex-col gap-2 rounded-lg bg-card p-3 sm:flex-row sm:items-center">
                      <span className="min-w-0 flex-1 text-sm">
                        <bdi className="block font-medium break-words">{u.name || '—'}</bdi>
                        <span className="block text-xs text-muted">
                          {u.email && <span className="ltr-embed">{u.email} · </span>}
                          {t('course.minutes', { count: Math.round(u.minutes) })}
                        </span>
                      </span>
                      <select
                        aria-label={a('matchTo', { name: u.name || u.email || '' })}
                        className={`${inputClass} sm:w-72`}
                        value={assign[u.index] ?? ''}
                        onChange={(e) => {
                          const next = { ...assign, [u.index]: e.target.value };
                          setAssign(next);
                          void refresh(preview, { assign: next, ignore, statuses, percent });
                        }}
                      >
                        <option value="">{a('pickStudent')}</option>
                        {students.map((st) => (
                          <option key={st.userId} value={st.userId}>
                            {studentLabel(st)}
                          </option>
                        ))}
                      </select>
                      <Button
                        type="button"
                        size="sm"
                        variant="ghost"
                        onClick={() => {
                          const next = new Set(ignore).add(u.index);
                          setIgnore(next);
                          void refresh(preview, { assign, ignore: next, statuses, percent });
                        }}
                      >
                        {a('ignore')}
                      </Button>
                    </li>
                  ))}
                </ul>
              </section>
            )}

            <AttendanceTable
              rows={preview.rows}
              preview
              onStatus={(userId, status) => {
                const next = { ...statuses, [userId]: status };
                setStatuses(next);
                void refresh(preview, { assign, ignore, statuses: next, percent });
              }}
              onIgnore={(indexes) => {
                const next = new Set(ignore);
                indexes.forEach((i) => next.add(i));
                setIgnore(next);
                void refresh(preview, { assign, ignore: next, statuses, percent });
              }}
            />
            <div className="flex flex-wrap gap-2">
              <Button type="button" onClick={() => void save()} loading={busy === 'save'} disabled={busy !== null}>
                {stored.recorded ? a('replace') : a('save')}
              </Button>
              <Button type="button" variant="ghost" onClick={() => setPreview(null)}>
                {t('admin.common.cancel')}
              </Button>
            </div>
            {stored.recorded && <p className="text-xs text-muted">{a('replaceHint')}</p>}
          </div>
        )}
      </Card>

      <Card>
        <h3 className="text-lg">{a('recorded')}</h3>
        {!stored.recorded ? (
          <p className="mt-1 text-sm text-muted">{a('nothingYet')}</p>
        ) : (
          <>
            <p className="mt-1 text-sm text-muted">
              {a('previewSummary', { present: stored.counts.present, partial: stored.counts.partial, absent: stored.counts.absent, percent: stored.presentPercent })}
              {stored.updatedAt && ` · ${a('updated', { date: formatDate(stored.updatedAt, locale) })}`}
            </p>
            <div className="mt-3">
              <AttendanceTable rows={stored.rows} onStatus={(userId, status) => void mark(userId, status)} />
            </div>
          </>
        )}
      </Card>
    </div>
  );
}

/** Student, minutes, %, status (changeable by hand), points. */
function AttendanceTable({
  rows,
  preview = false,
  onStatus,
  onIgnore,
}: {
  rows: AttendanceRowDto[];
  preview?: boolean;
  onStatus: (userId: string, status: AttendanceStatus) => void;
  onIgnore?: (records: number[]) => void;
}) {
  const { t } = useI18n();
  const a = (k: string, v?: Record<string, string | number>) => t(`attendance.${k}`, v);
  const signed = (n: number) => (n > 0 ? `+${n}` : String(n));
  return (
    <div className="overflow-x-auto rounded-xl border border-line bg-card">
      <table className="w-full min-w-[36rem] text-sm">
        <thead className="bg-muted-bg text-muted">
          <tr>
            <th scope="col" className="px-3 py-2 text-start font-medium">
              {a('student')}
            </th>
            <th scope="col" className="px-3 py-2 text-end font-medium">
              {a('minutes')}
            </th>
            <th scope="col" className="px-3 py-2 text-end font-medium">
              %
            </th>
            <th scope="col" className="px-3 py-2 text-start font-medium">
              {a('status')}
            </th>
            <th scope="col" className="px-3 py-2 text-end font-medium">
              {a('points')}
            </th>
          </tr>
        </thead>
        <tbody className="divide-y divide-line-soft">
          {rows.map((r) => (
            <tr key={r.userId} className="align-top">
              <td className="px-3 py-2">
                <bdi className="block font-medium break-words">{r.name ?? r.email}</bdi>
                <span className="block text-xs text-muted ltr-embed">{r.email}</span>
                <span className="mt-1 flex flex-wrap items-center gap-1.5">
                  {r.matchedBy === 'NAME' && <Badge tone="warning">{a('byName')}</Badge>}
                  {r.matchedBy === 'MANUAL' && <Badge tone="info">{a('byHand')}</Badge>}
                  {r.source === 'MANUAL' && <Badge tone="info">{a('markedByHand')}</Badge>}
                  {preview && r.matchedBy === 'NAME' && onIgnore && (
                    <button type="button" className="min-h-8 text-xs text-primary underline" onClick={() => onIgnore(r.records)}>
                      {a('notThem')}
                    </button>
                  )}
                </span>
              </td>
              <td className="px-3 py-2 text-end tabular-nums" dir="ltr">
                {r.minutes}
              </td>
              <td className="px-3 py-2 text-end tabular-nums" dir="ltr">
                {r.percent}%
              </td>
              <td className="px-3 py-2">
                <select
                  aria-label={a('statusFor', { name: r.name ?? r.email })}
                  className={`${inputClass} w-auto min-w-32`}
                  value={r.status}
                  onChange={(e) => onStatus(r.userId, e.target.value as AttendanceStatus)}
                >
                  {ATTENDANCE_STATUSES.map((s) => (
                    <option key={s} value={s}>
                      {t(`attendance.statuses.${s}`)}
                    </option>
                  ))}
                </select>
              </td>
              <td className="px-3 py-2 text-end tabular-nums" dir="ltr">
                {r.points}
                {preview && r.change !== 0 && <span className={`block text-xs ${r.change < 0 ? 'text-danger' : 'text-success'}`}>{signed(r.change)}</span>}
              </td>
            </tr>
          ))}
          {rows.length === 0 && (
            <tr>
              <td colSpan={5} className="px-3 py-4 text-muted">
                {a('noStudents')}
              </td>
            </tr>
          )}
        </tbody>
      </table>
    </div>
  );
}
