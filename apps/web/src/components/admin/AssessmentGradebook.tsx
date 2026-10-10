'use client';

import { SUBMISSION_FILTERS, type AdminSubmissionDto, type GradebookRow, type SubmissionFilter } from '@academy/shared';
import { useCallback, useEffect, useRef, useState, type FormEvent } from 'react';
import { TextAreaField, TextField } from '@/components/forms/fields';
import { QuizReview } from '@/components/learn/QuizReview';
import { Alert } from '@/components/ui/Alert';
import { Badge, type Tone } from '@/components/ui/Badge';
import { Button } from '@/components/ui/Button';
import { useI18n } from '@/i18n/client';
import { api } from '@/lib/api';
import { errorMessage } from '@/lib/errors';
import { formatDateTime } from '@/lib/format';

interface Book {
  assessment: { id: string; type: string; titleEn: string; titleAr: string; maxPoints: number; dueAt: string | null; submissionKind: string | null };
  rows: GradebookRow[];
}

const stateTone: Record<GradebookRow['state'], Tone> = { MISSING: 'danger', IN_PROGRESS: 'info', SUBMITTED: 'warning', GRADED: 'success' };
const repoTone = { PUBLIC: 'success', NOT_PUBLIC: 'danger', UNVERIFIED: 'warning' } as const;
const num = (n: number) => String(Number(n.toFixed(2)));

/** One submission: the work (link, PDF, quiz answers) and the grading form. */
function GradePanel({ id, onSaved, onClose }: { id: string; onSaved: () => void; onClose: () => void }) {
  const { locale, t } = useI18n();
  const g = (k: string, v?: Record<string, string | number>) => t(`admin.assessments.grading.${k}`, v);
  const [current, setCurrent] = useState(id);
  const [s, setS] = useState<AdminSubmissionDto | null>(null);
  const [score, setScore] = useState('');
  const [feedback, setFeedback] = useState('');
  const [rubric, setRubric] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [scoreError, setScoreError] = useState<string | undefined>();
  const [notice, setNotice] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const heading = useRef<HTMLHeadingElement>(null);

  useEffect(() => {
    setS(null);
    api<AdminSubmissionDto>(`/admin/submissions/${current}`)
      .then((x) => {
        setS(x);
        setScore(x.score !== null ? num(x.score) : '');
        setFeedback(x.feedback ?? '');
        setRubric(x.rubricNotes ?? '');
        requestAnimationFrame(() => heading.current?.focus());
      })
      .catch((err) => setError(errorMessage(err, t)));
  }, [current, t]);

  async function openFile() {
    setError(null);
    const tab = window.open('', '_blank');
    try {
      const { url } = await api<{ url: string }>(`/admin/submissions/${current}/file`);
      if (tab) tab.location.href = url;
      else window.location.href = url;
    } catch (err) {
      tab?.close();
      setError(errorMessage(err, t));
    }
  }

  async function save(e: FormEvent) {
    e.preventDefault();
    if (!s) return;
    setNotice(null);
    setError(null);
    const n = Number(score);
    if (score.trim() === '' || !Number.isFinite(n) || n < 0 || n > s.maxScore) {
      setScoreError(t('forms.errors.invalid'));
      document.querySelector<HTMLInputElement>('#grade-score input')?.focus();
      return;
    }
    setScoreError(undefined);
    setBusy(true);
    try {
      setS(await api<AdminSubmissionDto>(`/admin/submissions/${current}/grade`, { method: 'PUT', json: { score: n, feedback: feedback || null, rubricNotes: rubric || null } }));
      setNotice(g('saved'));
      onSaved();
    } catch (err) {
      setError(errorMessage(err, t));
    } finally {
      setBusy(false);
    }
  }

  if (!s) return error ? <Alert tone="danger">{error}</Alert> : <p className="text-muted">{t('admin.common.loading')}</p>;

  return (
    <section aria-labelledby="grade-title" className="flex flex-col gap-4 rounded-card border border-primary/40 bg-card p-4 sm:p-6">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div>
          <h3 id="grade-title" ref={heading} tabIndex={-1} className="text-lg focus:outline-none">
            {s.student.name ?? s.student.email}
          </h3>
          <p className="text-sm text-muted" dir="ltr">
            {s.student.email}
          </p>
        </div>
        <Button size="sm" variant="secondary" onClick={onClose}>
          {g('close')}
        </Button>
      </div>
      {s.attempts.length > 1 && (
        <div className="flex flex-wrap gap-2">
          {s.attempts.map((x) => (
            <Button key={x.id} size="sm" variant={x.id === current ? 'primary' : 'secondary'} aria-pressed={x.id === current} onClick={() => setCurrent(x.id)}>
              {g('attempt', { n: x.attempt })}
              {x.score !== null && ` · ${num(x.score)}`}
            </Button>
          ))}
        </div>
      )}
      <dl className="grid gap-x-4 gap-y-1 text-[0.9375rem] sm:grid-cols-[auto_1fr]">
        {s.submittedAt && (
          <>
            <dt className="text-muted">{g('submittedAt')}</dt>
            <dd className="flex flex-wrap items-center gap-2">
              {formatDateTime(s.submittedAt, locale)}
              {s.late && <Badge tone="warning">{g('late')}</Badge>}
            </dd>
          </>
        )}
        {s.url && (
          <>
            <dt className="text-muted">{g('link')}</dt>
            <dd className="flex min-w-0 flex-wrap items-center gap-2 break-all" dir="ltr">
              <a href={s.url} target="_blank" rel="noopener noreferrer" className="text-primary underline">
                {s.url}
              </a>
              {s.repoCheck && <Badge tone={repoTone[s.repoCheck]}>{t(`admin.assessments.book.repo.${s.repoCheck}`)}</Badge>}
            </dd>
          </>
        )}
        {(s.hasFile || s.fileName) && (
          <>
            <dt className="text-muted">PDF</dt>
            <dd>
              {s.hasFile ? (
                <button type="button" onClick={openFile} className="inline-flex min-h-11 items-center text-primary underline sm:min-h-0">
                  {g('viewFile')} {s.fileName && `(${s.fileName})`}
                </button>
              ) : (
                <span className="text-muted">{g('fileDeleted')}</span>
              )}
            </dd>
          </>
        )}
        {s.note && (
          <>
            <dt className="text-muted">{g('note')}</dt>
            <dd className="whitespace-pre-line">{s.note}</dd>
          </>
        )}
      </dl>
      {s.attested && <p className="text-sm text-muted">✓ {g('attested')}</p>}
      {s.repoCheck === 'UNVERIFIED' && <Alert tone="warning">{g('unverified')}</Alert>}
      {s.review && <QuizReview review={s.review} />}
      {error && <Alert tone="danger">{error}</Alert>}
      {notice && <Alert tone="success">{notice}</Alert>}
      {s.submittedAt && (
        <form onSubmit={save} noValidate className="flex flex-col gap-3 border-t border-line pt-4">
          <div id="grade-score">
          <TextField
            label={g('score', { max: s.maxScore })}
            required
            type="number"
            inputMode="decimal"
            min={0}
            max={s.maxScore}
            step="0.5"
            value={score}
            onChange={setScore}
            error={scoreError}
            className="max-w-48"
          />
          </div>
          <TextAreaField label={g('feedback')} value={feedback} onChange={setFeedback} rows={4} maxLength={5000} />
          <TextAreaField label={g('rubric')} value={rubric} onChange={setRubric} rows={3} maxLength={5000} />
          <div className="flex flex-wrap items-center gap-3">
            <Button type="submit" loading={busy}>
              {g('save')}
            </Button>
            {s.gradedBy && s.gradedAt && (
              <span className="text-sm text-muted">
                {g('gradedBy', { name: s.gradedBy })} · {formatDateTime(s.gradedAt, locale)}
              </span>
            )}
          </div>
        </form>
      )}
    </section>
  );
}

/** Per assessment: every enrolled student, filters (to grade / graded / late / missing) and grading. */
export function AssessmentGradebook({ assessmentId, onBack }: { assessmentId: string; onBack: () => void }) {
  const { locale, t } = useI18n();
  const b = (k: string, v?: Record<string, string | number>) => t(`admin.assessments.book.${k}`, v);
  const [filter, setFilter] = useState<SubmissionFilter>('all');
  const [book, setBook] = useState<Book | null>(null);
  const [open, setOpen] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(() => {
    api<Book>(`/admin/assessments/${assessmentId}/submissions?filter=${filter}`)
      .then(setBook)
      .catch((err) => setError(errorMessage(err, t)));
  }, [assessmentId, filter, t]);
  useEffect(load, [load]);

  const title = book ? (locale === 'ar' ? book.assessment.titleAr : book.assessment.titleEn) : '';

  return (
    <div className="space-y-4">
      <button type="button" onClick={onBack} className="inline-flex min-h-11 items-center gap-1.5 text-sm text-muted hover:underline">
        <span aria-hidden className="inline-block rtl:rotate-180">
          ←
        </span>{' '}
        {b('back')}
      </button>
      <h2 className="text-xl">
        {b('title')}
        {title && `: ${title}`}
      </h2>
      {error && <Alert tone="danger">{error}</Alert>}
      <div role="group" aria-label={b('state')} className="flex flex-wrap gap-2">
        {SUBMISSION_FILTERS.map((f) => (
          <button
            key={f}
            type="button"
            aria-pressed={filter === f}
            onClick={() => setFilter(f)}
            className={`min-h-10 rounded-full border px-4 text-sm font-medium ${filter === f ? 'border-primary bg-primary-soft text-primary' : 'border-line-strong bg-card text-body hover:bg-muted-bg'}`}
          >
            {b(`filter.${f}`)}
          </button>
        ))}
      </div>
      {open && (
        <GradePanel
          key={open}
          id={open}
          onClose={() => setOpen(null)}
          onSaved={load}
        />
      )}
      {/* Phones: one card per student (a wide table would push the page sideways). */}
      <ul className="flex flex-col gap-2 sm:hidden">
        {book && book.rows.length === 0 && <li className="rounded-card border border-line bg-card p-4 text-center text-muted">{b('none')}</li>}
        {book?.rows.map((r) => (
          <li key={r.userId} className={`flex flex-col gap-2 rounded-card border border-line p-4 ${open && open === r.submissionId ? 'bg-primary-soft' : 'bg-card'}`}>
            <div className="flex items-start justify-between gap-2">
              <div className="min-w-0">
                <p className="font-semibold">{r.name ?? '—'}</p>
                <p className="truncate text-xs text-muted" dir="ltr">
                  {r.email}
                </p>
              </div>
              <span className="font-medium tabular-nums">{r.score !== null ? `${num(r.score)}/${r.maxScore}` : '—'}</span>
            </div>
            <div className="flex flex-wrap items-center gap-1.5 text-sm">
              <Badge tone={stateTone[r.state]}>{b(`stateOpt.${r.state}`)}</Badge>
              {r.late && <Badge tone="warning">{t('assessments.late')}</Badge>}
              {r.hasFile && <Badge>{b('file')}</Badge>}
              {r.repoCheck && <Badge tone={repoTone[r.repoCheck]}>{b(`repo.${r.repoCheck}`)}</Badge>}
              {r.submittedAt && <span className="text-xs text-muted">{formatDateTime(r.submittedAt, locale)}</span>}
            </div>
            {r.submissionId && (
              <Button size="sm" variant="secondary" className="self-start" onClick={() => setOpen(r.submissionId)} aria-label={`${b('open')}: ${r.name ?? r.email}`}>
                {b('open')}
              </Button>
            )}
          </li>
        ))}
      </ul>
      <div className="hidden overflow-x-auto rounded-card border border-line bg-card sm:block">
        <table className="w-full min-w-[44rem] text-sm">
          <thead className="bg-muted-bg text-xs text-muted">
            <tr>
              <th className="p-3 text-start">{b('student')}</th>
              <th className="p-3 text-start">{b('state')}</th>
              <th className="p-3 text-start">{b('submitted')}</th>
              <th className="p-3 text-start">{b('score')}</th>
              <th className="p-3 text-start">{b('work')}</th>
              <th className="p-3 text-start">
                <span className="sr-only">{t('admin.common.actions')}</span>
              </th>
            </tr>
          </thead>
          <tbody>
            {book && book.rows.length === 0 && (
              <tr>
                <td colSpan={6} className="p-6 text-center text-muted">
                  {b('none')}
                </td>
              </tr>
            )}
            {book?.rows.map((r) => (
              <tr key={r.userId} className={`border-t border-line ${open && open === r.submissionId ? 'bg-primary-soft' : ''}`}>
                <td className="p-3">
                  <p className="font-semibold">{r.name ?? '—'}</p>
                  <p className="text-xs text-muted" dir="ltr">
                    {r.email}
                  </p>
                </td>
                <td className="p-3">
                  <Badge tone={stateTone[r.state]}>{b(`stateOpt.${r.state}`)}</Badge>
                </td>
                <td className="p-3 whitespace-nowrap">
                  {r.submittedAt ? formatDateTime(r.submittedAt, locale) : '—'}
                  {r.late && (
                    <span className="ms-2">
                      <Badge tone="warning">{t('assessments.late')}</Badge>
                    </span>
                  )}
                  {r.attempts > 1 && <p className="text-xs text-muted">{t('assessments.attemptsAllowed', { count: r.attempts })}</p>}
                </td>
                <td className="p-3 font-medium tabular-nums">{r.score !== null ? `${num(r.score)}/${r.maxScore}` : '—'}</td>
                <td className="p-3">
                  <div className="flex flex-wrap items-center gap-1">
                    {r.url && (
                      <a href={r.url} target="_blank" rel="noopener noreferrer" className="text-primary underline" dir="ltr">
                        {r.url.replace(/^https:\/\/(www\.)?/, '').slice(0, 40)}
                      </a>
                    )}
                    {r.hasFile && <Badge>{b('file')}</Badge>}
                    {r.repoCheck && <Badge tone={repoTone[r.repoCheck]}>{b(`repo.${r.repoCheck}`)}</Badge>}
                  </div>
                </td>
                <td className="p-3 text-end">
                  {r.submissionId && (
                    <Button size="sm" variant="secondary" onClick={() => setOpen(r.submissionId)} aria-label={`${b('open')}: ${r.name ?? r.email}`}>
                      {b('open')}
                    </Button>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
