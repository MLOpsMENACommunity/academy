'use client';

import {
  CHALLENGE_DEFAULT_ICON,
  CHALLENGE_FEEDBACK_MAX,
  CHALLENGE_STATUSES,
  challengeInputSchema,
  challengeUpdateSchema,
  type ChallengeStatus,
  type StaffChallengeDto,
  type StaffChallengeEntryDto,
} from '@academy/shared';
import { useCallback, useEffect, useState, type FormEvent } from 'react';
import { toLocalInput } from '@/components/admin/CourseForm';
import { MarkdownField } from '@/components/admin/MarkdownField';
import { SelectField, TextAreaField, TextField } from '@/components/forms/fields';
import { Alert } from '@/components/ui/Alert';
import { Badge } from '@/components/ui/Badge';
import { Button } from '@/components/ui/Button';
import { PageSpinner } from '@/components/ui/Spinner';
import { useI18n } from '@/i18n/client';
import { api, ApiError } from '@/lib/api';
import { errorMessage } from '@/lib/errors';
import { formatDateTime } from '@/lib/format';
import { issuesToErrors } from '@/lib/zod-errors';
import { challengeDates, entryTone, localTitle, phaseTone } from './ChallengeCard';

type Draft = {
  courseId: string;
  slug: string;
  titleEn: string;
  titleAr: string;
  descriptionEn: string;
  descriptionAr: string;
  startsAt: string;
  endsAt: string;
  points: string;
  icon: string;
  status: ChallengeStatus;
};

const emptyDraft = (): Draft => {
  const start = new Date();
  start.setMinutes(0, 0, 0);
  return {
    courseId: '',
    slug: '',
    titleEn: '',
    titleAr: '',
    descriptionEn: '',
    descriptionAr: '',
    startsAt: toLocalInput(start.toISOString()),
    endsAt: toLocalInput(new Date(start.getTime() + 7 * 86_400_000).toISOString()),
    points: '50',
    icon: CHALLENGE_DEFAULT_ICON,
    status: 'DRAFT',
  };
};

const fromDto = (c: StaffChallengeDto): Draft => ({
  courseId: c.courseId ?? '',
  slug: c.slug,
  titleEn: c.titleEn,
  titleAr: c.titleAr,
  descriptionEn: c.descriptionEn,
  descriptionAr: c.descriptionAr,
  startsAt: toLocalInput(c.startsAt),
  endsAt: toLocalInput(c.endsAt),
  points: String(c.points),
  icon: c.icon,
  status: c.status,
});

/** A datetime-local value (the viewer's own time) as an ISO instant; '' stays '' so the schema reports it. */
const toIso = (v: string) => (v ? new Date(v).toISOString() : '');

/**
 * Challenges and their review queue, for Admin → Challenges (every challenge, any course) and
 * Teaching → {course} → Challenges (that course's). `canManage`: create and edit
 * (MANAGE_ASSESSMENTS, or the academic preset); `canReview`: approve and reject (GRADE).
 */
export function ChallengesManager({ apiBase, canManage, canReview, pickCourse }: { apiBase: string; canManage: boolean; canReview: boolean; pickCourse?: boolean }) {
  const { locale, t } = useI18n();
  const m = (k: string, v?: Record<string, string | number>) => t(`challenges.manage.${k}`, v);
  const [list, setList] = useState<StaffChallengeDto[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [editing, setEditing] = useState<StaffChallengeDto | 'new' | null>(null);
  const [reviewing, setReviewing] = useState<StaffChallengeDto | null>(null);
  const [courses, setCourses] = useState<{ id: string; titleEn: string; titleAr: string }[]>([]);

  const load = useCallback(() => {
    api<StaffChallengeDto[]>(apiBase)
      .then(setList)
      .catch((err: unknown) => setError(errorMessage(err, t)));
  }, [apiBase, t]);
  useEffect(load, [load]);
  useEffect(() => {
    if (pickCourse) api<{ id: string; titleEn: string; titleAr: string }[]>('/admin/courses').then(setCourses).catch(() => undefined);
  }, [pickCourse]);

  if (error) return <Alert tone="danger">{error}</Alert>;
  if (!list) return <PageSpinner />;

  if (editing) {
    return (
      <ChallengeForm
        apiBase={apiBase}
        initial={editing === 'new' ? null : editing}
        courses={pickCourse ? courses : null}
        onDone={(saved) => {
          setEditing(null);
          if (saved) load();
        }}
      />
    );
  }
  if (reviewing) {
    return (
      <ReviewQueue
        apiBase={apiBase}
        challenge={reviewing}
        canReview={canReview}
        onBack={() => {
          setReviewing(null);
          load();
        }}
      />
    );
  }

  const pending = list.reduce((n, c) => n + c.counts.PENDING, 0);
  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="text-sm text-muted">{pending ? m('pendingTotal', { count: pending }) : m('nothingPending')}</p>
        {canManage && <Button onClick={() => setEditing('new')}>{m('new')}</Button>}
      </div>
      {!list.length ? (
        <p className="text-muted">{m('empty')}</p>
      ) : (
        <ul className="space-y-3">
          {list.map((c) => (
            <li key={c.id} className="rounded-card border border-line bg-card p-4">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div className="min-w-0">
                  <p className="font-semibold break-words">
                    <span aria-hidden>{c.icon}</span> {localTitle(c, locale)}
                  </p>
                  <p className="mt-1 text-sm text-muted">
                    {challengeDates(c, locale)} · {c.course ? localTitle(c.course, locale) : t('challenges.forEveryone')} · {m('pointsValue', { points: c.points })}
                  </p>
                  <div className="mt-2 flex flex-wrap gap-2">
                    <Badge tone={c.status === 'PUBLISHED' ? 'success' : c.status === 'DRAFT' ? 'warning' : 'neutral'}>{m(`status.${c.status}`)}</Badge>
                    <Badge tone={phaseTone[c.phase]}>{t(`challenges.phase.${c.phase}`)}</Badge>
                    <Badge tone={c.counts.PENDING ? 'warning' : 'neutral'}>{m('pendingCount', { count: c.counts.PENDING })}</Badge>
                    <Badge tone="success">{m('approvedCount', { count: c.counts.APPROVED })}</Badge>
                  </div>
                </div>
                <div className="flex flex-wrap gap-2">
                  <Button size="sm" variant="secondary" onClick={() => setReviewing(c)}>
                    {m('entries')}
                  </Button>
                  {canManage && (
                    <Button size="sm" variant="secondary" onClick={() => setEditing(c)}>
                      {t('common.edit')}
                    </Button>
                  )}
                </div>
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function ChallengeForm({
  apiBase,
  initial,
  courses,
  onDone,
}: {
  apiBase: string;
  initial: StaffChallengeDto | null;
  courses: { id: string; titleEn: string; titleAr: string }[] | null;
  onDone: (saved: boolean) => void;
}) {
  const { locale, t } = useI18n();
  const m = (k: string, v?: Record<string, string | number>) => t(`challenges.manage.${k}`, v);
  const [d, setD] = useState<Draft>(() => (initial ? fromDto(initial) : emptyDraft()));
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const set = (k: keyof Draft) => (v: string | null) => setD((x) => ({ ...x, [k]: v ?? '' }));

  const save = async (e: FormEvent) => {
    e.preventDefault();
    const payload = { ...d, startsAt: toIso(d.startsAt), endsAt: toIso(d.endsAt), points: d.points === '' ? undefined : Number(d.points) };
    const parsed = (initial ? challengeUpdateSchema : challengeInputSchema).safeParse(payload);
    if (!parsed.success) {
      setErrors(issuesToErrors(parsed.error.issues, t));
      return;
    }
    setErrors({});
    setError(null);
    setBusy(true);
    try {
      await api(initial ? `${apiBase}/${initial.id}` : apiBase, { method: initial ? 'PUT' : 'POST', json: parsed.data });
      onDone(true);
    } catch (err) {
      if (err instanceof ApiError && err.errors.length) setErrors(Object.fromEntries(err.errors.map((x) => [x.path, x.path === 'slug' ? m('slugTaken') : t('forms.errors.invalid')])));
      setError(errorMessage(err, t));
    } finally {
      setBusy(false);
    }
  };

  return (
    <form onSubmit={save} noValidate className="space-y-5">
      <h2 className="text-xl">{initial ? m('editTitle') : m('newTitle')}</h2>
      <p className="max-w-3xl text-sm text-muted">{m('formIntro')}</p>
      <div className="grid gap-4 sm:grid-cols-2">
        {courses && !initial && (
          <SelectField
            label={m('course')}
            hint={m('courseHint')}
            value={d.courseId}
            onChange={set('courseId')}
            placeholder={t('challenges.forEveryone')}
            options={courses.map((c) => ({ value: c.id, label: locale === 'ar' ? c.titleAr || c.titleEn : c.titleEn }))}
          />
        )}
        <TextField label={m('slug')} hint={initial ? m('slugFixed') : m('slugHint')} required dir="ltr" value={d.slug} onChange={set('slug')} error={errors.slug} disabled={Boolean(initial)} />
        <TextField label={m('titleEn')} required dir="ltr" value={d.titleEn} onChange={set('titleEn')} error={errors.titleEn} maxLength={120} />
        <TextField label={m('titleAr')} required dir="rtl" value={d.titleAr} onChange={set('titleAr')} error={errors.titleAr} maxLength={120} />
        <TextField label={m('startsAt')} required type="datetime-local" value={d.startsAt} onChange={set('startsAt')} error={errors.startsAt} />
        <TextField label={m('endsAt')} required type="datetime-local" value={d.endsAt} onChange={set('endsAt')} error={errors.endsAt} />
        <TextField label={m('points')} hint={m('pointsHint')} required type="number" min={0} max={500} inputMode="numeric" value={d.points} onChange={set('points')} error={errors.points} />
        <TextField label={m('icon')} hint={m('iconHint')} required value={d.icon} onChange={set('icon')} error={errors.icon} maxLength={16} />
        <SelectField label={m('statusLabel')} required value={d.status} onChange={(v) => setD((x) => ({ ...x, status: (v as ChallengeStatus) ?? 'DRAFT' }))} options={CHALLENGE_STATUSES.map((s) => ({ value: s, label: m(`status.${s}`) }))} />
      </div>
      <MarkdownField label={m('descriptionEn')} dir="ltr" value={d.descriptionEn} onChange={set('descriptionEn')} />
      {errors.descriptionEn && <p className="text-sm text-danger">{errors.descriptionEn}</p>}
      <MarkdownField label={m('descriptionAr')} dir="rtl" value={d.descriptionAr} onChange={set('descriptionAr')} />
      {errors.descriptionAr && <p className="text-sm text-danger">{errors.descriptionAr}</p>}
      {error && (
        <p role="alert" className="text-sm text-danger">
          {error}
        </p>
      )}
      <div className="flex flex-wrap gap-3">
        <Button type="submit" loading={busy}>
          {t('common.save')}
        </Button>
        <Button type="button" variant="secondary" onClick={() => onDone(false)}>
          {t('common.cancel')}
        </Button>
      </div>
    </form>
  );
}

function ReviewQueue({ apiBase, challenge: c, canReview, onBack }: { apiBase: string; challenge: StaffChallengeDto; canReview: boolean; onBack: () => void }) {
  const { locale, t } = useI18n();
  const m = (k: string, v?: Record<string, string | number>) => t(`challenges.manage.${k}`, v);
  const [entries, setEntries] = useState<StaffChallengeEntryDto[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const base = `${apiBase}/${c.id}/entries`;

  useEffect(() => {
    api<StaffChallengeEntryDto[]>(base)
      .then(setEntries)
      .catch((err: unknown) => setError(errorMessage(err, t)));
  }, [base, t]);

  return (
    <div className="space-y-4">
      <button type="button" onClick={onBack} className="inline-flex min-h-11 items-center gap-1.5 text-sm text-muted hover:underline">
        <span aria-hidden className="inline-block rtl:rotate-180">
          ←
        </span>
        {m('back')}
      </button>
      <h2 className="text-xl break-words">{m('entriesTitle', { title: localTitle(c, locale) })}</h2>
      {error && <Alert tone="danger">{error}</Alert>}
      {!entries && !error && <PageSpinner />}
      {entries && !entries.length && <p className="text-muted">{m('noEntries')}</p>}
      {entries && entries.length > 0 && (
        <ul className="space-y-3">
          {entries.map((e) => (
            <li key={e.id}>
              <EntryRow entry={e} canReview={canReview} reviewUrl={`${base}/${e.id}/review`} onSaved={(next) => setEntries((l) => l?.map((x) => (x.id === next.id ? next : x)) ?? l)} />
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function EntryRow({ entry: e, canReview, reviewUrl, onSaved }: { entry: StaffChallengeEntryDto; canReview: boolean; reviewUrl: string; onSaved: (e: StaffChallengeEntryDto) => void }) {
  const { locale, t } = useI18n();
  const m = (k: string, v?: Record<string, string | number>) => t(`challenges.manage.${k}`, v);
  const [feedback, setFeedback] = useState(e.feedback ?? '');
  const [busy, setBusy] = useState<'APPROVE' | 'REJECT' | null>(null);
  const [error, setError] = useState<string | null>(null);

  const decide = async (decision: 'APPROVE' | 'REJECT') => {
    if (decision === 'REJECT' && !feedback.trim()) {
      setError(m('feedbackNeeded'));
      return;
    }
    setBusy(decision);
    setError(null);
    try {
      onSaved(await api<StaffChallengeEntryDto>(reviewUrl, { method: 'POST', json: { decision, feedback } }));
    } catch (err) {
      setError(errorMessage(err, t));
    } finally {
      setBusy(null);
    }
  };

  const who = e.student.name ?? e.student.email ?? '—';
  return (
    <article aria-label={who} className="rounded-card border border-line bg-card p-4">
      <div className="flex flex-wrap items-center gap-2">
        <p className="font-semibold">{who}</p>
        {e.student.name && e.student.email && <p className="text-sm text-muted" dir="ltr">{e.student.email}</p>}
        <Badge tone={entryTone[e.status]}>{t(`challenges.entryStatus.${e.status}`)}</Badge>
      </div>
      <p className="mt-2 text-sm break-all">
        <a href={e.url} target="_blank" rel="noopener noreferrer nofollow" className="text-primary underline" dir="ltr">
          {e.url}
        </a>
      </p>
      {e.note && (
        <p dir="auto" className="mt-2 text-sm whitespace-pre-line text-body">
          {e.note}
        </p>
      )}
      <p className="mt-2 text-xs text-muted">
        {m('updated', { date: formatDateTime(e.updatedAt, locale) })}
        {e.reviewedAt && ` · ${m('reviewed', { date: formatDateTime(e.reviewedAt, locale), who: e.reviewer ?? m('theTeam') })}`}
      </p>
      {canReview ? (
        <div className="mt-3 space-y-3">
          <TextAreaField label={m('feedback')} hint={m('feedbackHint')} value={feedback} onChange={setFeedback} rows={2} maxLength={CHALLENGE_FEEDBACK_MAX} dir="auto" />
          <div className="flex flex-wrap gap-2">
            <Button size="sm" onClick={() => void decide('APPROVE')} loading={busy === 'APPROVE'} disabled={busy !== null}>
              {m(e.status === 'APPROVED' ? 'approveAgain' : 'approve')}
            </Button>
            <Button size="sm" variant="secondary" onClick={() => void decide('REJECT')} loading={busy === 'REJECT'} disabled={busy !== null}>
              {m('reject')}
            </Button>
          </div>
          {e.status === 'APPROVED' && <p className="text-xs text-muted">{m('rejectAfterApprove')}</p>}
        </div>
      ) : (
        e.feedback && (
          <p dir="auto" className="mt-2 text-sm whitespace-pre-line">
            {e.feedback}
          </p>
        )
      )}
      {error && (
        <p role="alert" className="mt-2 text-sm text-danger">
          {error}
        </p>
      )}
    </article>
  );
}
