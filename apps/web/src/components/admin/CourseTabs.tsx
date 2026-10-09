'use client';

import {
  QUESTION_TYPES,
  questionInputSchema,
  questionTypeLabels,
  sessionInputSchema,
  type Material,
  type QuestionOption,
  type QuestionType,
} from '@academy/shared';
import { useCallback, useEffect, useState, type FormEvent } from 'react';
import { CheckboxField, SelectField, TextAreaField, TextField } from '@/components/forms/fields';
import { Alert } from '@/components/ui/Alert';
import { Badge } from '@/components/ui/Badge';
import { Button } from '@/components/ui/Button';
import { Card } from '@/components/ui/Card';
import { useI18n } from '@/i18n/client';
import { api } from '@/lib/api';
import { downloadViaApi } from '@/lib/download';
import { errorMessage } from '@/lib/errors';
import { formatDate, formatDateTime } from '@/lib/format';
import { issuesToErrors } from '@/lib/zod-errors';
import { fromLocalInput, ListEditor, toLocalInput } from './CourseForm';
import { TopicsField } from './TopicsField';

// ------------------------------------------------------------------ screening questions

export interface QuestionRow {
  id?: string;
  type: QuestionType;
  labelEn: string;
  labelAr: string;
  helpEn?: string | null;
  helpAr?: string | null;
  options?: QuestionOption[] | null;
  required: boolean;
}

export function QuestionsEditor({ courseId, initial, onChange }: { courseId: string; initial: QuestionRow[]; onChange?: () => void }) {
  const { locale, t } = useI18n();
  const [items, setItems] = useState<QuestionRow[]>(initial);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const [busy, setBusy] = useState(false);
  const c = (k: string) => t(`admin.courses.${k}`);

  async function save() {
    setError(null);
    for (const [i, q] of items.entries()) {
      const r = questionInputSchema.safeParse(q);
      if (!r.success) {
        setError(`#${i + 1}: ${r.error.issues[0]?.message ?? t('forms.fixErrors')}`);
        return;
      }
    }
    setBusy(true);
    try {
      const next = await api<QuestionRow[]>(`/admin/courses/${courseId}/questions`, { method: 'PUT', json: { questions: items } });
      setItems(next);
      setSaved(true);
      onChange?.();
    } catch (err) {
      setError(errorMessage(err, t));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Card>
      {error && <Alert tone="danger" className="mb-4">{error}</Alert>}
      <ListEditor<QuestionRow>
        title={c('questions')}
        items={items}
        onChange={(x) => {
          setItems(x);
          setSaved(false);
        }}
        empty={{ type: 'SHORT_TEXT', labelEn: '', labelAr: '', required: true }}
        addLabel={c('addQuestion')}
        render={(q, change) => {
          const withOptions = q.type === 'SINGLE_SELECT' || q.type === 'MULTI_SELECT';
          return (
            <div className="space-y-2">
              <div className="grid gap-2 sm:grid-cols-[12rem_1fr]">
                <SelectField
                  label={c('qType')}
                  required
                  value={q.type}
                  onChange={(x) => change({ ...q, type: (x ?? 'SHORT_TEXT') as QuestionType })}
                  options={QUESTION_TYPES.map((x) => ({ value: x, label: questionTypeLabels[x][locale] }))}
                />
                <div className="self-end pb-2">
                  <CheckboxField label={c('qRequired')} checked={q.required} onChange={(x) => change({ ...q, required: x })} />
                </div>
              </div>
              <div className="grid gap-2 sm:grid-cols-2">
                <TextField label={t('admin.courses.fields.qEn')} required value={q.labelEn} onChange={(x) => change({ ...q, labelEn: x })} />
                <TextField label={t('admin.courses.fields.qAr')} required dir="rtl" value={q.labelAr} onChange={(x) => change({ ...q, labelAr: x })} />
                <TextField label={c('helpEn')} value={q.helpEn ?? ''} onChange={(x) => change({ ...q, helpEn: x || null })} />
                <TextField label={c('helpAr')} dir="rtl" value={q.helpAr ?? ''} onChange={(x) => change({ ...q, helpAr: x || null })} />
              </div>
              {withOptions && (
                <ListEditor<QuestionOption>
                  title={c('options')}
                  items={q.options ?? []}
                  onChange={(options) => change({ ...q, options })}
                  empty={{ value: '', labelEn: '', labelAr: '' }}
                  addLabel={c('addOption')}
                  render={(o, ch) => (
                    <div className="space-y-2">
                      <div className="grid gap-2 sm:grid-cols-3">
                        <TextField label={c('optionValue')} required dir="ltr" value={o.value} onChange={(x) => ch({ ...o, value: x })} />
                        <TextField label="EN" required value={o.labelEn} onChange={(x) => ch({ ...o, labelEn: x })} />
                        <TextField label="AR" required dir="rtl" value={o.labelAr} onChange={(x) => ch({ ...o, labelAr: x })} />
                      </div>
                      {/* e.g. "My own domain (to be approved)": applicants who pick it must describe it. */}
                      {q.type === 'SINGLE_SELECT' && (
                        <CheckboxField
                          label={c('optionDetail')}
                          checked={Boolean(o.requiresDetail)}
                          onChange={(x) => ch({ ...o, requiresDetail: x || undefined })}
                        />
                      )}
                    </div>
                  )}
                />
              )}
            </div>
          );
        }}
      />
      <div className="mt-4 flex items-center gap-3">
        <Button onClick={save} loading={busy}>
          {t('admin.common.save')}
        </Button>
        <span role="status" className="text-sm text-success">
          {saved ? `✓ ${t('admin.common.saved')}` : ''}
        </span>
      </div>
    </Card>
  );
}

// ------------------------------------------------------------------ sessions

export interface SessionRow {
  id: string;
  order: number;
  titleEn: string;
  titleAr: string;
  descriptionEn: string | null;
  descriptionAr: string | null;
  startsAt: string;
  durationMin: number;
  liveUrl: string | null;
  recordingUrl: string | null;
  assignmentUrl: string | null;
  materials: Material[];
  topics: string[];
}

type SessionDraft = Omit<SessionRow, 'id' | 'order' | 'startsAt'> & { startsAt: string };

const EMPTY_SESSION: SessionDraft = {
  titleEn: '',
  titleAr: '',
  descriptionEn: null,
  descriptionAr: null,
  startsAt: '',
  durationMin: 90,
  liveUrl: null,
  recordingUrl: null,
  assignmentUrl: null,
  materials: [],
  topics: [],
};

function SessionForm({ initial, onSubmit, onCancel }: { initial: SessionDraft; onSubmit: (s: SessionDraft) => Promise<void>; onCancel?: () => void }) {
  const { t } = useI18n();
  const [s, setS] = useState(initial);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [formError, setFormError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const c = (k: string) => t(`admin.courses.${k}`);
  const set = <K extends keyof SessionDraft>(k: K) => (v: SessionDraft[K]) => setS((p) => ({ ...p, [k]: v }));

  async function submit(e: FormEvent) {
    e.preventDefault();
    setFormError(null);
    const parsed = sessionInputSchema.safeParse({ ...s, startsAt: fromLocalInput(s.startsAt) ?? '' });
    if (!parsed.success) {
      setErrors(issuesToErrors(parsed.error.issues, t));
      return;
    }
    setErrors({});
    setBusy(true);
    try {
      await onSubmit(s);
    } catch (err) {
      setFormError(errorMessage(err, t));
    } finally {
      setBusy(false);
    }
  }

  return (
    <form onSubmit={submit} noValidate className="space-y-3">
      {formError && <Alert tone="danger">{formError}</Alert>}
      <div className="grid gap-3 sm:grid-cols-2">
        <TextField label={c('sessionTitleEn')} required value={s.titleEn} onChange={set('titleEn')} error={errors.titleEn} />
        <TextField label={c('sessionTitleAr')} required dir="rtl" value={s.titleAr} onChange={set('titleAr')} error={errors.titleAr} />
        <TextAreaField label={c('topicsEn')} hint={c('topicsHint')} value={s.descriptionEn ?? ''} onChange={(x) => set('descriptionEn')(x || null)} rows={6} />
        <TextAreaField label={c('topicsAr')} hint={c('topicsHint')} dir="rtl" value={s.descriptionAr ?? ''} onChange={(x) => set('descriptionAr')(x || null)} rows={6} />
        <TextField label={c('startsAt')} required type="datetime-local" value={s.startsAt} onChange={set('startsAt')} error={errors.startsAt} />
        <TextField label={c('duration')} required type="number" min={15} value={String(s.durationMin)} onChange={(x) => set('durationMin')(Number(x || 0))} error={errors.durationMin} />
        <TextField label={c('liveUrl')} type="url" dir="ltr" value={s.liveUrl ?? ''} onChange={(x) => set('liveUrl')(x || null)} error={errors.liveUrl} />
        <TextField label={c('recordingUrl')} type="url" dir="ltr" value={s.recordingUrl ?? ''} onChange={(x) => set('recordingUrl')(x || null)} error={errors.recordingUrl} />
        <TextField label={c('assignmentUrl')} type="url" dir="ltr" value={s.assignmentUrl ?? ''} onChange={(x) => set('assignmentUrl')(x || null)} error={errors.assignmentUrl} />
        <TopicsField label={c('fields.sessionTags')} hint={t('admin.sessions.fields.topicsHint')} value={s.topics ?? []} onChange={set('topics')} error={errors.topics} />
      </div>
      <ListEditor<Material>
        title={c('materials')}
        items={s.materials}
        onChange={set('materials')}
        empty={{ labelEn: '', labelAr: '', url: '' }}
        addLabel={c('addMaterial')}
        render={(m, ch) => (
          <div className="grid gap-2 sm:grid-cols-3">
            <TextField label={c('materialLabelEn')} required value={m.labelEn} onChange={(x) => ch({ ...m, labelEn: x })} />
            <TextField label={c('materialLabelAr')} required dir="rtl" value={m.labelAr} onChange={(x) => ch({ ...m, labelAr: x })} />
            <TextField label="URL" required type="url" dir="ltr" value={m.url} onChange={(x) => ch({ ...m, url: x })} />
          </div>
        )}
      />
      {errors.materials && <p className="text-sm text-danger">{errors.materials}</p>}
      <div className="flex gap-2">
        <Button type="submit" loading={busy}>
          {c('saveSession')}
        </Button>
        {onCancel && (
          <Button type="button" variant="secondary" onClick={onCancel}>
            {t('admin.common.cancel')}
          </Button>
        )}
      </div>
    </form>
  );
}

/** Weekly dates in the admin's own time zone, so "7:00 PM" stays 7:00 PM across DST changes. */
export function weeklyDates(first: string, count: number, skipWeeks: number[]): Date[] {
  const out: Date[] = [];
  const start = new Date(first);
  for (let week = 1; out.length < count && week < count + skipWeeks.length + 52; week++) {
    if (skipWeeks.includes(week)) continue;
    const d = new Date(start);
    d.setDate(start.getDate() + 7 * (week - 1));
    out.push(d);
  }
  return out;
}

function WeeklySessions({ courseId, nextNumber, onCreated, onCancel }: { courseId: string; nextNumber: number; onCreated: (rows: SessionRow[]) => void; onCancel: () => void }) {
  const { locale, t } = useI18n();
  const c = (k: string, v?: Record<string, string | number>) => t(`admin.courses.weekly.${k}`, v);
  const [first, setFirst] = useState('');
  const [count, setCount] = useState('6');
  const [duration, setDuration] = useState('90');
  const [skip, setSkip] = useState('');
  const [liveUrl, setLiveUrl] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const skipWeeks = skip.split(/[\s,]+/).map(Number).filter((n) => Number.isInteger(n) && n > 0);
  const n = Math.min(52, Math.max(0, Number(count) || 0));
  const dates = first && n ? weeklyDates(first, n, skipWeeks) : [];

  async function create() {
    setError(null);
    if (!dates.length) return;
    setBusy(true);
    try {
      const rows = await api<SessionRow[]>(`/admin/courses/${courseId}/sessions/bulk`, {
        method: 'POST',
        json: {
          sessions: dates.map((d, i) => ({
            titleEn: `Session ${nextNumber + i}`,
            titleAr: `الجلسة ${nextNumber + i}`,
            startsAt: d.toISOString(),
            durationMin: Number(duration) || 90,
            liveUrl: liveUrl || null,
            materials: [],
          })),
        },
      });
      onCreated(rows);
    } catch (err) {
      setError(errorMessage(err, t));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Card>
      <h3 className="text-lg">{c('title')}</h3>
      <p className="mt-1 text-sm text-muted">{c('help')}</p>
      {error && <Alert tone="danger" className="mt-3">{error}</Alert>}
      <div className="mt-4 grid gap-3 sm:grid-cols-2">
        <TextField label={c('first')} required type="datetime-local" value={first} onChange={setFirst} />
        <TextField label={c('count')} required type="number" min={1} max={52} value={count} onChange={setCount} />
        <TextField label={t('admin.courses.duration')} required type="number" min={15} value={duration} onChange={setDuration} />
        <TextField label={c('skip')} hint={c('skipHint')} value={skip} onChange={setSkip} dir="ltr" />
        <div className="sm:col-span-2">
          <TextField label={c('liveUrl')} hint={c('liveUrlHint')} type="url" dir="ltr" value={liveUrl} onChange={setLiveUrl} />
        </div>
      </div>
      {dates.length > 0 && (
        <ol className="mt-4 space-y-1 rounded-lg bg-muted-bg p-3 text-sm">
          {dates.map((d, i) => (
            <li key={d.toISOString()}>
              {locale === 'ar' ? `الجلسة ${nextNumber + i}` : `Session ${nextNumber + i}`} · {formatDateTime(d.toISOString(), locale, Intl.DateTimeFormat().resolvedOptions().timeZone)}
            </li>
          ))}
        </ol>
      )}
      <div className="mt-4 flex gap-2">
        <Button type="button" loading={busy} disabled={!dates.length} onClick={create}>
          {c('create', { count: dates.length })}
        </Button>
        <Button type="button" variant="secondary" onClick={onCancel}>
          {t('admin.common.cancel')}
        </Button>
      </div>
    </Card>
  );
}

export function SessionsEditor({ courseId, initial, onChange }: { courseId: string; initial: SessionRow[]; onChange?: () => void }) {
  const { locale, t } = useI18n();
  const [sessions, setSessions] = useState<SessionRow[]>(initial);
  const [editing, setEditing] = useState<string | 'new' | 'weekly' | null>(null);
  const [error, setError] = useState<string | null>(null);
  const base = `/admin/courses/${courseId}/sessions`;
  const toDraft = (s: SessionRow): SessionDraft => ({ ...s, startsAt: toLocalInput(s.startsAt) });
  const payload = (s: SessionDraft) => ({ ...s, startsAt: fromLocalInput(s.startsAt) });

  async function move(i: number, d: number) {
    const next = [...sessions];
    const [x] = next.splice(i, 1);
    next.splice(i + d, 0, x!);
    setError(null);
    try {
      setSessions(await api<SessionRow[]>(`${base}/order`, { method: 'PUT', json: { ids: next.map((s) => s.id) } }));
      onChange?.();
    } catch (err) {
      setError(errorMessage(err, t));
    }
  }

  async function remove(s: SessionRow) {
    if (!window.confirm(t('admin.courses.deleteSession', { title: locale === 'ar' ? s.titleAr : s.titleEn }))) return;
    setError(null);
    try {
      await api(`${base}/${s.id}`, { method: 'DELETE' });
      setSessions((xs) => xs.filter((x) => x.id !== s.id));
      onChange?.();
    } catch (err) {
      setError(errorMessage(err, t));
    }
  }

  return (
    <div className="space-y-3">
      {error && <Alert tone="danger">{error}</Alert>}
      {sessions.length === 0 && editing !== 'new' && <p className="text-muted">{t('admin.common.none')}</p>}
      <ol className="space-y-3">
        {sessions.map((s, i) => (
          <li key={s.id}>
            <Card>
              {editing === s.id ? (
                <SessionForm
                  initial={toDraft(s)}
                  onCancel={() => setEditing(null)}
                  onSubmit={async (d) => {
                    const saved = await api<SessionRow>(`${base}/${s.id}`, { method: 'PUT', json: payload(d) });
                    setSessions((xs) => xs.map((x) => (x.id === s.id ? saved : x)));
                    onChange?.();
                    setEditing(null);
                  }}
                />
              ) : (
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div>
                    <p className="font-semibold text-fg">
                      {i + 1}. {locale === 'ar' ? s.titleAr : s.titleEn}
                    </p>
                    <p className="text-sm text-muted">
                      {formatDateTime(s.startsAt, locale)} · {t('admin.courses.minutes', { count: s.durationMin })}
                    </p>
                    <div className="mt-1 flex flex-wrap gap-1">
                      {s.liveUrl && <Badge tone="info">{t('admin.courses.badgeLive')}</Badge>}
                      {s.recordingUrl && <Badge tone="success">{t('admin.courses.badgeRecording')}</Badge>}
                      {s.assignmentUrl && <Badge tone="accent">{t('admin.courses.badgeAssignment')}</Badge>}
                      {s.materials.length > 0 && <Badge>{t('admin.courses.badgeMaterials', { count: s.materials.length })}</Badge>}
                    </div>
                  </div>
                  <div className="flex flex-wrap gap-1 text-xs">
                    <button type="button" disabled={i === 0} onClick={() => move(i, -1)} className="rounded border border-line px-2 py-1 disabled:opacity-40" aria-label={t('admin.common.moveUp')}>
                      ↑
                    </button>
                    <button type="button" disabled={i === sessions.length - 1} onClick={() => move(i, 1)} className="rounded border border-line px-2 py-1 disabled:opacity-40" aria-label={t('admin.common.moveDown')}>
                      ↓
                    </button>
                    <button type="button" onClick={() => setEditing(s.id)} className="rounded border border-line px-2 py-1">
                      {t('admin.common.edit')}
                    </button>
                    <button type="button" onClick={() => remove(s)} className="rounded border border-danger/40 px-2 py-1 text-danger">
                      {t('admin.common.delete')}
                    </button>
                  </div>
                </div>
              )}
            </Card>
          </li>
        ))}
      </ol>
      {editing === 'new' ? (
        <Card>
          <SessionForm
            initial={EMPTY_SESSION}
            onCancel={() => setEditing(null)}
            onSubmit={async (d) => {
              const created = await api<SessionRow>(base, { method: 'POST', json: payload(d) });
              setSessions((xs) => [...xs, created]);
              onChange?.();
              setEditing(null);
            }}
          />
        </Card>
      ) : editing === 'weekly' ? (
        <WeeklySessions
          courseId={courseId}
          nextNumber={sessions.length + 1}
          onCancel={() => setEditing(null)}
          onCreated={(rows) => {
            setSessions(rows);
            setEditing(null);
            onChange?.();
          }}
        />
      ) : (
        <div className="flex flex-wrap gap-2">
          <Button variant="secondary" onClick={() => setEditing('new')}>
            + {t('admin.courses.addSession')}
          </Button>
          <Button variant="secondary" onClick={() => setEditing('weekly')}>
            + {t('admin.courses.weekly.title')}
          </Button>
        </div>
      )}
    </div>
  );
}

// ------------------------------------------------------------------ enrolled students (Risk 1)

interface EnrolledRow {
  id: string;
  userId: string;
  /** Account deleted: only the Google address to remove is shown. */
  deleted: boolean;
  name: string | null;
  email: string | null;
  googleEmail: string | null;
  phone: string | null;
  enrolledAt: string;
  driveAccessGranted: boolean;
  driveAccessGrantedAt: string | null;
  driveRevokeEmail: string | null;
  progress: { completed: number; total: number };
}

export function EnrolledStudents({ courseId, usesDrive, initialPendingOnly = false }: { courseId: string; usesDrive: boolean; initialPendingOnly?: boolean }) {
  const { locale, t } = useI18n();
  const [rows, setRows] = useState<EnrolledRow[] | null>(null);
  const [pendingOnly, setPendingOnly] = useState(initialPendingOnly);
  const [copied, setCopied] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const c = (k: string, v?: Record<string, string>) => t(`admin.courses.${k}`, v);

  const load = useCallback(() => {
    api<EnrolledRow[]>(`/admin/courses/${courseId}/enrollments${pendingOnly ? '?driveAccess=pending' : ''}`)
      .then(setRows)
      .catch((err) => setError(errorMessage(err, t)));
  }, [courseId, pendingOnly, t]);
  useEffect(load, [load]);

  async function copy(key: string, list: EnrolledRow[]) {
    const emails = list.map((r) => r.googleEmail).filter(Boolean).join(', ');
    await navigator.clipboard.writeText(emails);
    setCopied(key);
    setTimeout(() => setCopied(null), 2000);
  }

  async function toggle(r: EnrolledRow, granted: boolean) {
    setError(null);
    try {
      await api(`/admin/enrollments/${r.id}/drive-access`, { method: 'PUT', json: { granted } });
      load();
    } catch (err) {
      setError(errorMessage(err, t));
    }
  }

  async function markRemoved(r: EnrolledRow) {
    setError(null);
    try {
      await api(`/admin/enrollments/${r.id}/drive-removed`, { method: 'POST' });
      load();
    } catch (err) {
      setError(errorMessage(err, t));
    }
  }

  const revoke = rows?.filter((r) => r.driveRevokeEmail) ?? [];
  const active = rows?.filter((r) => !r.deleted) ?? [];

  return (
    <div className="space-y-4">
      {usesDrive && <Alert tone="danger">{c('driveWarning')}</Alert>}
      {error && <Alert tone="danger">{error}</Alert>}
      {revoke.length > 0 && (
        <Alert tone="warning">
          <ul className="list-disc ps-5">
            {revoke.map((r) => (
              <li key={r.id} dir="auto" className="py-1">
                {c('removeOld', { email: r.driveRevokeEmail! })} ({r.deleted ? c('accountDeleted') : (r.name ?? r.email)})
                <button type="button" onClick={() => markRemoved(r)} className="ms-2 rounded border border-warning/50 px-2 py-0.5 text-xs font-semibold">
                  {c('markRemoved')}
                </button>
              </li>
            ))}
          </ul>
        </Alert>
      )}
      <div className="flex flex-wrap items-center gap-2">
        <Button size="sm" onClick={() => copy('all', active)}>
          {copied === 'all' ? `✓ ${t('admin.common.copied')}` : c('copyEmails')}
        </Button>
        <Button size="sm" variant="secondary" onClick={() => copy('pending', active.filter((r) => !r.driveAccessGranted))}>
          {copied === 'pending' ? `✓ ${t('admin.common.copied')}` : c('copyPending')}
        </Button>
        <Button size="sm" variant="secondary" onClick={() => downloadViaApi(`/admin/courses/${courseId}/enrollments.csv`, 'enrolled-students.csv').catch((err: unknown) => setError(errorMessage(err, t)))}>
          ⬇ {t('admin.common.export')}
        </Button>
        <label className="ms-auto flex items-center gap-2 text-sm">
          <input type="checkbox" checked={pendingOnly} onChange={(e) => setPendingOnly(e.target.checked)} className="size-4" />
          {c('pendingOnly')}
        </label>
      </div>
      <div className="overflow-x-auto rounded-card border border-line bg-card">
        <table className="w-full min-w-[46rem] text-sm">
          <thead className="bg-muted-bg text-xs text-muted">
            <tr>
              <th className="p-3 text-start">{t('admin.apps.student')}</th>
              <th className="p-3 text-start">Google</th>
              <th className="p-3 text-start">{t('admin.students.joined')}</th>
              <th className="p-3 text-start">{c('progress')}</th>
              <th className="p-3 text-start">{c('driveGranted')}</th>
            </tr>
          </thead>
          <tbody>
            {rows && active.length === 0 && (
              <tr>
                <td colSpan={5} className="p-6 text-center text-muted">
                  {t('admin.common.none')}
                </td>
              </tr>
            )}
            {active.map((r) => (
              <tr key={r.id} className="border-t border-line">
                <td className="p-3">
                  <p className="font-semibold">{r.name ?? '—'}</p>
                  <p className="text-xs text-muted" dir="ltr">
                    {r.email}
                    {r.phone ? ` · ${r.phone}` : ''}
                  </p>
                </td>
                <td className="p-3" dir="ltr">
                  {r.googleEmail ?? <span className="text-warning">{c('noGoogle')}</span>}
                </td>
                <td className="p-3 whitespace-nowrap">{formatDate(r.enrolledAt, locale)}</td>
                <td className="p-3">
                  {r.progress.completed}/{r.progress.total}
                </td>
                <td className="p-3">
                  <label className="flex items-center gap-2">
                    <input type="checkbox" className="size-5" checked={r.driveAccessGranted} onChange={(e) => toggle(r, e.target.checked)} aria-label={`${c('driveGranted')}: ${r.name ?? r.email}`} />
                    {r.driveAccessGrantedAt && <span className="text-xs text-muted">{formatDate(r.driveAccessGrantedAt, locale)}</span>}
                  </label>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

// ------------------------------------------------------------------ feedback

interface FeedbackSummary {
  count: number;
  average: number | null;
  comments: { rating: number; comment: string; by: string | null; at: string }[];
}

export function FeedbackPanel({ courseId }: { courseId: string }) {
  const { locale, t } = useI18n();
  const [data, setData] = useState<{ sessions: (FeedbackSummary & { id: string; order: number; titleEn: string; titleAr: string })[]; course: FeedbackSummary } | null>(null);
  const [error, setError] = useState(false);
  useEffect(() => {
    api<typeof data>(`/admin/courses/${courseId}/feedback`)
      .then(setData)
      .catch(() => setError(true));
  }, [courseId]);
  if (error) return <Alert tone="danger">{t('errors.generic')}</Alert>;
  if (!data) return <p className="text-muted">{t('admin.common.loading')}</p>;

  const block = (title: string, s: FeedbackSummary, key: string) => (
    <Card key={key}>
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h3 className="font-semibold text-fg">{title}</h3>
        <span className="text-sm text-muted">
          {s.average !== null ? `★ ${t('admin.courses.avg', { avg: String(s.average), count: String(s.count) })}` : t('admin.courses.noFeedback')}
        </span>
      </div>
      {s.comments.length > 0 && (
        <ul className="mt-3 space-y-2">
          {s.comments.map((x, i) => (
            <li key={i} className="rounded-lg bg-muted-bg p-3 text-sm">
              <p dir="auto" className="whitespace-pre-wrap">
                {x.comment}
              </p>
              <p className="mt-1 text-xs text-muted">
                {'★'.repeat(x.rating)} · {x.by ?? '—'} · {formatDate(x.at, locale)}
              </p>
            </li>
          ))}
        </ul>
      )}
    </Card>
  );

  return (
    <div className="space-y-3">
      {block(t('admin.courses.courseLevel'), data.course, 'course')}
      {data.sessions.map((s) => block(`${s.order}. ${locale === 'ar' ? s.titleAr : s.titleEn}`, s, s.id))}
    </div>
  );
}
